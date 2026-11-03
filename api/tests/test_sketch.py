"""Sketch reader accuracy on a hand-drawn mockup and on synthetic sketches (clean scan and phone photo).

These run OCR, so each takes a few seconds.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main
from app.sample import sample_project
from app.sketch.reader import SketchError, read_sketch
from app.store import ProjectStore
from app.units import MM_PER_FT

from .sketchgen import draw_sketch

FIXTURES = Path(__file__).parent / "fixtures"
INCH = 25.4


def size(room) -> tuple[float, float]:
    xs = [p[0] for p in room.polygon]
    ys = [p[1] for p in room.polygon]
    return max(xs) - min(xs), max(ys) - min(ys)


def plot_size(model) -> tuple[float, float]:
    return max(p[0] for p in model.plot.polygon), max(p[1] for p in model.plot.polygon)


@pytest.fixture(scope="module")
def mockup():
    return read_sketch((FIXTURES / "mockup_sketch.png").read_bytes(), "Mockup")


def test_mockup_plot_road_and_gate(mockup):
    m = mockup.model
    w, d = plot_size(m)
    assert w == pytest.approx(40 * MM_PER_FT, abs=6 * INCH)
    assert d == pytest.approx(60 * MM_PER_FT, abs=6 * INCH)
    assert m.plot.road_sides == ["east"]
    assert m.plot.gate and m.plot.gate[1] == pytest.approx(12 * MM_PER_FT)
    assert all(v == pytest.approx(5 * MM_PER_FT, abs=6 * INCH) for v in (m.plot.setbacks.front, m.plot.setbacks.rear))


def test_mockup_rooms_named(mockup):
    types = sorted(r.type for r in mockup.model.floors[0].rooms)
    assert types.count("bedroom") == 3
    assert types.count("toilet") == 2
    for t in ("kitchen", "parking", "living"):
        assert t in types
    rooms = {r.type: r for r in mockup.model.floors[0].rooms}
    assert size(rooms["parking"]) == pytest.approx((12 * MM_PER_FT, 16 * MM_PER_FT), abs=6 * INCH)


def test_mockup_contradictions_are_reported(mockup):
    # the top row is written as 12' + 5' + 5' + 12' = 34' inside a 30' house
    assert any("Toilet width" in w for w in mockup.warnings)
    assert any("staircase" in w.lower() for w in mockup.warnings)
    assert mockup.overlay["image"].startswith("data:image/jpeg;base64,")
    assert mockup.overlay["walls"] and mockup.overlay["plot"]


@pytest.mark.parametrize("photo", [False, True], ids=["scan", "phone-photo"])
def test_synthetic_sketch_reads_written_sizes(photo):
    truth = sample_project()
    result = read_sketch(draw_sketch(truth, photo=photo), "Synthetic")
    rooms = result.model.floors[0].rooms
    assert result.stats["page_flattened"] is photo
    assert len(rooms) == len(truth.floors[0].rooms)
    # every labelled room comes back with its written size, although the drawing is stretched 18%
    for want in truth.floors[0].rooms:
        if want.type in ("stair", "foyer"):  # not labelled on the synthetic sketch
            continue
        got = min((r for r in rooms if r.type == want.type), key=lambda r: abs(size(r)[0] - size(want)[0]) + abs(size(r)[1] - size(want)[1]))
        assert size(got) == pytest.approx(size(want), abs=6 * INCH), want.name


def test_blank_page_is_rejected():
    import cv2
    import numpy as np

    ok, png = cv2.imencode(".png", np.full((800, 600, 3), 240, np.uint8))
    with pytest.raises(SketchError):
        read_sketch(png.tobytes())


def test_sketch_endpoint_creates_project(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ProjectStore(tmp_path / "t.db"))
    client = TestClient(main.app)
    res = client.post("/api/sketch", content=(FIXTURES / "mockup_sketch.png").read_bytes(),
                      headers={"Content-Type": "image/png", "X-Filename": "my plan.png"})
    assert res.status_code == 201, res.text
    body = res.json()
    project = client.get(f"/api/projects/{body['id']}").json()
    assert project["name"] == "my plan"
    assert len(project["floors"][0]["rooms"]) >= 8
    assert body["report"]["warnings"] and body["report"]["overlay"]["walls"]

    bad = client.post("/api/sketch", content=b"not an image", headers={"Content-Type": "image/png"})
    assert bad.status_code == 422
