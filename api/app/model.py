"""BuildingModel: the single source of truth every view and export is rendered from.

All lengths are millimetres. Plan coordinates: x to the right, y away from the road
(the road side sits at the bottom of the drawing).
"""

from math import hypot
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Point = tuple[float, float]
Side = Literal["north", "south", "east", "west"]


class Setbacks(BaseModel):
    front: float
    rear: float
    left: float
    right: float


class Plot(BaseModel):
    polygon: list[Point]
    road_sides: list[Side] = ["east"]
    road_width: float | None = None
    gate: tuple[float, float] | None = None  # (x of gate start, width) on the road edge
    setbacks: Setbacks


class Wall(BaseModel):
    id: str
    a: Point
    b: Point
    thickness: float
    type: Literal["exterior", "interior"]
    assembly: str | None = None

    @property
    def length(self) -> float:
        return hypot(self.b[0] - self.a[0], self.b[1] - self.a[1])


OpeningStyle = Literal[
    "",  # default for the kind: single swing door / two-shutter casement window
    "single", "double", "sliding", "french",  # doors
    "casement", "sliding_window", "three_panel", "fixed",  # windows
    "louvered",  # ventilators
    "arch",  # openings
]


class Opening(BaseModel):
    id: str
    wall: str
    kind: Literal["door", "window", "opening", "ventilator"]
    style: OpeningStyle = ""
    offset: float  # distance from wall.a to the near edge of the opening
    width: float
    height: float
    sill: float = 0
    side: Literal[1, -1] = 1  # door swing: 1 = left of a→b, -1 = right


RoomType = Literal[
    "bedroom", "toilet", "kitchen", "living", "dining", "stair",
    "parking", "foyer", "puja", "utility", "balcony", "store", "other",
]


class Room(BaseModel):
    id: str
    name: str
    type: RoomType
    polygon: list[Point]
    label_raw: str | None = None  # text as written on the sketch, e.g. "रसोई"

    @property
    def area(self) -> float:
        pts = self.polygon
        s = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                for i in range(len(pts)))
        return abs(s) / 2


class Furniture(BaseModel):
    id: str
    type: str
    pos: Point
    rot: float = 0  # degrees, counter-clockwise
    size: tuple[float, float, float]  # width, depth, height


class Floor(BaseModel):
    level: int = 0
    height: float = 3048  # 10 ft floor-to-floor
    slab: float = 150
    plinth: float = 457.2  # 1'6" above ground
    walls: list[Wall]
    openings: list[Opening] = []
    rooms: list[Room] = []
    furniture: list[Furniture] = []


class Roof(BaseModel):
    type: Literal["flat_rcc"] = "flat_rcc"
    parapet: float = 914  # 3 ft


class Layer(BaseModel):
    name: str
    material: str
    thickness: float


class Assembly(BaseModel):
    id: str
    name: str
    function: str
    layers: list[Layer]


class BuildingModel(BaseModel):
    schema_version: int = 1
    name: str
    display_units: Literal["ft", "m"] = "ft"
    north_deg: float = Field(0, description="True north, clockwise from the drawing's up direction")
    structure: Literal["rcc_frame", "load_bearing"] = "rcc_frame"
    plot: Plot
    floors: list[Floor]
    roof: Roof = Roof()
    assemblies: dict[str, Assembly] = {}
    # chosen construction options, e.g. {"wall.exterior.masonry": "aac_block", "room.R-bed1.floor": "vitrified"}
    specs: dict[str, str] = {}

    @model_validator(mode="after")
    def _check_openings(self) -> "BuildingModel":
        for floor in self.floors:
            walls = {w.id: w for w in floor.walls}
            if len(walls) != len(floor.walls):
                raise ValueError(f"duplicate wall ids on floor {floor.level}")
            for o in floor.openings:
                wall = walls.get(o.wall)
                if wall is None:
                    raise ValueError(f"opening {o.id} references unknown wall {o.wall}")
                if o.offset < 0 or o.offset + o.width > wall.length + 1e-6:
                    raise ValueError(f"opening {o.id} does not fit on wall {o.wall}")
                if o.sill + o.height > floor.height:
                    raise ValueError(f"opening {o.id} is taller than the floor")
        for wall in (w for f in self.floors for w in f.walls):
            if wall.assembly and wall.assembly not in self.assemblies:
                raise ValueError(f"wall {wall.id} uses unknown assembly {wall.assembly}")
        return self
