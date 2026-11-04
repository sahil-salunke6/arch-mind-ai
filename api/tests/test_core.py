import io

import ezdxf
import pytest
from pypdf import PdfReader
from fastapi.testclient import TestClient

from app import main
from app.model import BuildingModel
from app.sample import sample_project
from app.store import ProjectStore
from app.units import format_ft_in, parse_length, parse_size, sqft


@pytest.mark.parametrize("text, mm", [
    ("12'6\"", 3810), ("12'-6\"", 3810), ("12.5'", 3810), ("12 ft", 3657.6), ("9\"", 228.6),
    ("3.81m", 3810), ("3810mm", 3810), ("40", 12192),
])
def test_parse_length(text, mm):
    assert parse_length(text) == pytest.approx(mm)


def test_parse_size():
    assert parse_size("30x40") == pytest.approx((9144, 12192))
    assert parse_size("30'x40'") == pytest.approx((9144, 12192))


def test_format_ft_in_round_trips():
    assert format_ft_in(3810) == "12'-6\""
    assert format_ft_in(12192) == "40'"
    assert format_ft_in(parse_length("10'-3\"")) == "10'-3\""


def test_sample_is_valid_and_sized():
    model = sample_project()
    rooms = {r.name: r for r in model.floors[0].rooms}
    assert sqft(rooms["Bedroom 1"].area) == pytest.approx(168)
    assert sum(r.type == "bedroom" for r in rooms.values()) == 3
    BuildingModel.model_validate_json(model.model_dump_json())


def test_rejects_opening_wider_than_wall():
    data = sample_project().model_dump()
    data["floors"][0]["openings"][0]["width"] = 1e6
    with pytest.raises(ValueError, match="does not fit"):
        BuildingModel.model_validate(data)


def test_api_round_trip_and_dxf(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ProjectStore(tmp_path / "t.db"))
    client = TestClient(main.app)
    assert [p["id"] for p in client.get("/api/projects").json()] == ["sample"]
    model = client.get("/api/projects/sample").json()
    model["name"] = "Changed"
    assert client.put("/api/projects/sample", json=model).status_code == 200
    assert client.get("/api/projects/sample").json()["name"] == "Changed"

    res = client.get("/api/projects/sample/export.dxf")
    assert res.status_code == 200
    path = tmp_path / "plan.dxf"
    path.write_bytes(res.content)
    layers = {e.dxf.layer for e in ezdxf.readfile(path).modelspace()}
    assert {"A-WALL", "A-DOOR", "A-GLAZ", "A-ROOM-TEXT", "A-DIMS"} <= layers


def test_pdf_blueprint(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ProjectStore(tmp_path / "t.db"))
    res = TestClient(main.app).get("/api/projects/sample/export.pdf")
    assert res.status_code == 200
    assert res.headers["content-disposition"].endswith('Residence_Plot_40x60.pdf"')
    pages = PdfReader(io.BytesIO(res.content)).pages
    assert len(pages) == 2
    plan, elevations = (p.extract_text() for p in pages)
    assert "GROUND FLOOR PLAN" in plan and "DOOR & WINDOW SCHEDULE" in plan and "CONCEPT DRAWING ONLY" in plan
    for title in ("EAST ELEVATION (FRONT)", "WEST ELEVATION", "NORTH ELEVATION", "SOUTH ELEVATION", "SECTION A-A"):
        assert title in elevations


def test_opening_schedule_groups_identical_openings():
    from app.export_pdf import opening_schedule
    codes, rows = opening_schedule(sample_project().floors[0])
    by_code = {r["code"]: r for r in rows}
    assert codes["D-bed1"] == codes["D-bed2"] == codes["D-bed3"]
    assert by_code[codes["D-bed1"]]["count"] == 4
    assert sum(r["count"] for r in rows) == len(codes)


def test_detect_rooms_keeps_names_when_walls_move():
    from app.rooms import detect_rooms
    model = sample_project()
    floor = model.floors[0]
    names = sorted(r.name for r in floor.rooms)
    assert sorted(r.name for r in detect_rooms(floor)) == names

    # shift the living/kitchen partition (x = 25 ft) by 1 ft: names stay, areas change
    walls = [w.model_copy(update={"a": (w.a[0] + 304.8, w.a[1]), "b": (w.b[0] + 304.8, w.b[1])}) if w.id == "W9" else w
             for w in floor.walls]
    rooms = {r.name: r for r in detect_rooms(floor.model_copy(update={"walls": walls}))}
    assert sorted(rooms) == names
    assert sqft(rooms["Living / Dining"].area) == pytest.approx(420)


def test_new_loop_becomes_unnamed_room():
    from app.model import Floor, Wall
    from app.rooms import detect_rooms
    sq = [(0, 0), (4000, 0), (4000, 3000), (0, 3000)]
    walls = [Wall(id=f"W{i}", a=sq[i], b=sq[(i + 1) % 4], thickness=115, type="interior") for i in range(4)]
    rooms = detect_rooms(Floor(walls=walls))
    assert [(r.name, r.type) for r in rooms] == [("Room 1", "other")]
    assert rooms[0].area == pytest.approx(12e6)


def test_blank_project_exports(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ProjectStore(tmp_path / "t.db"))
    client = TestClient(main.app)
    blank = sample_project().model_dump()
    blank["name"] = "Blank"
    blank["floors"][0].update(walls=[], openings=[], rooms=[], furniture=[])
    pid = client.post("/api/projects", json=blank).json()["id"]
    assert client.get(f"/api/projects/{pid}/export.pdf").status_code == 200
    assert client.get(f"/api/projects/{pid}/export.dxf").status_code == 200


def test_new_rooms_get_unused_names():
    from app.model import Floor, Room, Wall
    from app.rooms import detect_rooms
    # 8 m x 3 m box split in two; the left half is already "Room 1"
    pts = [(0, 0), (8000, 0), (8000, 3000), (0, 3000)]
    walls = [Wall(id=f"W{i}", a=pts[i], b=pts[(i + 1) % 4], thickness=115, type="interior") for i in range(4)]
    walls.append(Wall(id="W5", a=(4000, 0), b=(4000, 3000), thickness=115, type="interior"))
    left = Room(id="R-a", name="Room 1", type="other", polygon=[(0, 0), (4000, 0), (4000, 3000), (0, 3000)])
    names = sorted(r.name for r in detect_rooms(Floor(walls=walls, rooms=[left])))
    assert names == ["Room 1", "Room 2"]


def test_room_names_are_unique_even_with_duplicate_input():
    from app.model import Floor, Room, Wall
    from app.rooms import detect_rooms
    pts = [(0, 0), (8000, 0), (8000, 3000), (0, 3000)]
    walls = [Wall(id=f"W{i}", a=pts[i], b=pts[(i + 1) % 4], thickness=115, type="interior") for i in range(4)]
    walls.append(Wall(id="W5", a=(4000, 0), b=(4000, 3000), thickness=115, type="interior"))
    halves = [[(0, 0), (4000, 0), (4000, 3000), (0, 3000)], [(4000, 0), (8000, 0), (8000, 3000), (4000, 3000)]]
    same = [Room(id=f"R-{i}", name="Bedroom", type="bedroom", polygon=p) for i, p in enumerate(halves)]
    assert sorted(r.name for r in detect_rooms(Floor(walls=walls, rooms=same))) == ["Bedroom", "Bedroom (2)"]


def test_rename_and_delete_project(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ProjectStore(tmp_path / "t.db"))
    client = TestClient(main.app)
    pid = client.post("/api/projects").json()["id"]
    assert client.patch(f"/api/projects/{pid}", json={"name": "  Villa  "}).json()["name"] == "Villa"
    assert client.get(f"/api/projects/{pid}").json()["name"] == "Villa"
    assert client.patch(f"/api/projects/{pid}", json={"name": " "}).status_code == 422
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404
    assert client.delete(f"/api/projects/{pid}").status_code == 404


def test_opening_styles_in_schedule_and_pdf():
    from app.export_pdf import export_pdf, opening_name, opening_schedule
    model = sample_project()
    ops = model.floors[0].openings
    ops[:] = [o.model_copy(update={"style": "double"}) if o.id == "D-main" else o for o in ops]
    _, rows = opening_schedule(model.floors[0])
    names = {opening_name(r["kind"], r["style"]) for r in rows}
    assert {"Double door", "Single door", "Casement window", "Louvered ventilator"} <= names
    text = PdfReader(io.BytesIO(export_pdf(model))).pages[0].extract_text()
    assert "Double door" in text


def _two_storey():
    model = sample_project()
    ground = model.floors[0]
    stair = next(r for r in ground.rooms if r.type == "stair")
    keep = [w for w in ground.walls if w.type == "exterior"]
    ids = {w.id for w in keep}
    upper = ground.model_copy(update={
        "level": 1, "walls": keep, "furniture": [],
        "openings": [o for o in ground.openings if o.wall in ids and o.kind in ("window", "ventilator")],
        "rooms": [stair.model_copy(update={"id": "R-up-stair"})],
    })
    return model.model_copy(update={"floors": [ground, upper]})


def test_two_storey_exports(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ProjectStore(tmp_path / "p.db"))
    client = TestClient(main.app)
    pid = client.post("/api/projects", json=_two_storey().model_dump()).json()["id"]
    saved = client.get(f"/api/projects/{pid}").json()
    assert len(saved["floors"]) == 2 and saved["floors"][1]["rooms"]  # rooms detected upstairs too
    pdf = PdfReader(io.BytesIO(client.get(f"/api/projects/{pid}/export.pdf").content))
    assert len(pdf.pages) == 3  # ground plan, first floor plan, elevations
    assert "FIRST FLOOR PLAN" in pdf.pages[1].extract_text()
    assert "First Floor level" in pdf.pages[2].extract_text()
    doc = ezdxf.read(io.StringIO(client.get(f"/api/projects/{pid}/export.dxf").content.decode()))
    texts = [t.dxf.text for t in doc.modelspace().query("TEXT")]
    assert "GROUND FLOOR PLAN" in texts and "FIRST FLOOR PLAN" in texts
