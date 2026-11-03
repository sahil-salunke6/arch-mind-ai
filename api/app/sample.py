"""Sample project: a 40x60 ft east-facing 3BHK. Used by the UI demo and the tests."""

from .model import (
    Assembly, BuildingModel, Floor, Furniture, Layer, Opening, Plot, Room, Setbacks, Wall,
)
from .units import ft

EXT, INT = ft(0.75), 115.0  # 9" and 4.5" brick walls


def _p(x: float, y: float) -> tuple[float, float]:
    return (ft(x), ft(y))


def _rect(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    return [_p(x0, y0), _p(x1, y0), _p(x1, y1), _p(x0, y1)]


def _wall(id, a, b, kind="interior"):
    return Wall(id=id, a=_p(*a), b=_p(*b), thickness=EXT if kind == "exterior" else INT, type=kind,
                assembly="ext_brick_230" if kind == "exterior" else "int_brick_115")


def _open(id, wall, kind, offset, width, side=1):
    height, sill = {"door": (7, 0), "opening": (7, 0), "window": (4, 3), "ventilator": (1.5, 5.5)}[kind]
    if id == "parking":
        height = 8
    return Opening(id=id, wall=wall, kind=kind, offset=ft(offset), width=ft(width),
                   height=ft(height), sill=ft(sill), side=side)


def _furn(id, type, x, y, w, d, h, rot=0):
    return Furniture(id=id, type=type, pos=_p(x, y), rot=rot, size=(ft(w), ft(d), ft(h)))


def sample_project() -> BuildingModel:
    walls = [
        _wall("W1", (5, 5), (35, 5), "exterior"),     # front (road) wall
        _wall("W2", (35, 5), (35, 55), "exterior"),
        _wall("W3", (35, 55), (5, 55), "exterior"),
        _wall("W4", (5, 55), (5, 5), "exterior"),
        _wall("W5", (5, 21), (35, 21)),
        _wall("W6", (5, 41), (35, 41)),
        _wall("W7", (17, 5), (17, 21)),
        _wall("W8", (23, 5), (23, 21)),
        _wall("W9", (25, 21), (25, 41)),
        _wall("W10", (25, 29), (35, 29)),
        _wall("W11", (17, 41), (17, 55)),
        _wall("W12", (29, 41), (29, 55)),
        _wall("W13", (29, 48), (35, 48)),
    ]
    openings = [
        _open("parking", "W1", "opening", 1, 10),
        _open("D-main", "W1", "door", 13.25, 3.5),
        _open("W-bed3-f", "W1", "window", 24, 5),
        _open("W-bed3-s", "W2", "window", 6, 4),
        _open("W-stair", "W2", "window", 17, 3),
        _open("W-kitchen", "W2", "window", 28, 4),
        _open("V-toilet2", "W2", "ventilator", 38.5, 2),
        _open("V-toilet1", "W2", "ventilator", 45.5, 2),
        _open("W-bed2", "W3", "window", 10, 4),
        _open("W-bed1", "W3", "window", 22, 4),
        _open("W-bed1-s", "W4", "window", 5, 4),
        _open("W-living", "W4", "window", 22, 6),
        _open("A-living", "W5", "opening", 13.25, 3.5),
        _open("D-bed1", "W6", "door", 4, 3),
        _open("D-bed2", "W6", "door", 14, 3),
        _open("D-parking", "W7", "door", 7, 3, side=-1),
        _open("D-bed3", "W8", "door", 9, 3, side=-1),
        _open("A-stair", "W9", "opening", 1, 4),
        _open("A-kitchen", "W9", "opening", 10, 4),
        _open("D-toilet2", "W12", "door", 2, 2.5, side=-1),
        _open("D-toilet1", "W12", "door", 9, 2.5, side=-1),
    ]
    rooms = [
        Room(id="R-bed1", name="Bedroom 1", type="bedroom", polygon=_rect(5, 41, 17, 55)),
        Room(id="R-bed2", name="Master Bedroom", type="bedroom", polygon=_rect(17, 41, 29, 55)),
        Room(id="R-t1", name="Toilet 1", type="toilet", polygon=_rect(29, 48, 35, 55)),
        Room(id="R-t2", name="Toilet 2", type="toilet", polygon=_rect(29, 41, 35, 48)),
        Room(id="R-living", name="Living / Dining", type="living", polygon=_rect(5, 21, 25, 41)),
        Room(id="R-kitchen", name="Kitchen", type="kitchen", polygon=_rect(25, 29, 35, 41), label_raw="रसोई"),
        Room(id="R-stair", name="Staircase", type="stair", polygon=_rect(25, 21, 35, 29)),
        Room(id="R-parking", name="Parking", type="parking", polygon=_rect(5, 5, 17, 21)),
        Room(id="R-foyer", name="Foyer", type="foyer", polygon=_rect(17, 5, 23, 21)),
        Room(id="R-bed3", name="Bedroom 3", type="bedroom", polygon=_rect(23, 5, 35, 21)),
    ]
    furniture = [
        _furn("F-bed1", "bed_double", 11, 51.2, 5, 6.5, 1.8),
        _furn("F-bed2", "bed_double", 23, 51.2, 5.5, 6.5, 1.8),
        _furn("F-bed3", "bed_double", 31.3, 13, 5, 6.5, 1.8, rot=-90),
        _furn("F-ward1", "wardrobe", 7.8, 42.2, 5, 2, 7),
        _furn("F-ward2", "wardrobe", 26.2, 42.2, 5, 2, 7),
        _furn("F-sofa", "sofa", 7.1, 29, 7, 3, 2.8, rot=-90),
        _furn("F-ctable", "coffee_table", 11, 29, 2, 3.5, 1.4),
        _furn("F-tv", "tv_unit", 15, 23, 6, 1.5, 2),
        _furn("F-dining", "dining_table", 18.5, 36, 6, 3.5, 2.5),
        *[_furn(f"F-chair{i}", "chair", x, y, 1.5, 1.5, 3)
          for i, (x, y) in enumerate([(16.8, 38.6), (20.2, 38.6), (16.8, 33.4), (20.2, 33.4)])],
        _furn("F-counter1", "kitchen_counter", 33.6, 35, 2, 11.2, 3),
        _furn("F-counter2", "kitchen_counter", 29.2, 39.6, 6.8, 2, 3),
        _furn("F-car", "car", 11, 12.5, 6, 14, 4.8),
        _furn("F-wc1", "wc", 33.8, 53.5, 1.5, 2.2, 1.3, rot=-90),
        _furn("F-wc2", "wc", 33.8, 46.5, 1.5, 2.2, 1.3, rot=-90),
    ]
    assemblies = {
        "ext_brick_230": Assembly(
            id="ext_brick_230", name="External Wall", function="External infill wall (RCC frame)",
            layers=[
                Layer(name="External plaster (1:4)", material="cement_plaster", thickness=18),
                Layer(name="Clay brick masonry", material="clay_brick", thickness=200),
                Layer(name="Internal plaster (1:6)", material="cement_plaster", thickness=12),
            ],
        ),
        "int_brick_115": Assembly(
            id="int_brick_115", name="Internal Partition", function="Internal, non load-bearing",
            layers=[
                Layer(name="Plaster (1:6)", material="cement_plaster", thickness=12),
                Layer(name="Clay brick (half brick)", material="clay_brick", thickness=91),
                Layer(name="Plaster (1:6)", material="cement_plaster", thickness=12),
            ],
        ),
    }
    return BuildingModel(
        name="Residence Plot 40×60",
        north_deg=90,  # road (bottom of the drawing) faces east, so north points right
        plot=Plot(
            polygon=_rect(0, 0, 40, 60), road_sides=["east"], road_width=ft(30),
            gate=(ft(5), ft(12)),  # in line with the parking bay
            setbacks=Setbacks(front=ft(5), rear=ft(5), left=ft(5), right=ft(5)),
        ),
        floors=[Floor(walls=walls, openings=openings, rooms=rooms, furniture=furniture)],
        assemblies=assemblies,
    )
