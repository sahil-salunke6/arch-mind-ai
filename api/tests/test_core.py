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
