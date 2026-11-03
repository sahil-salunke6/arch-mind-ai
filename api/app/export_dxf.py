"""DXF concept plan (millimetres) that opens in AutoCAD / LibreCAD."""

import io
from math import atan2, degrees

import ezdxf
from ezdxf.enums import TextEntityAlignment
from shapely.geometry import Polygon
from shapely.ops import unary_union

from .geometry import point_on_wall, solid_spans, span_rect, wall_frame
from .model import BuildingModel
from .units import format_ft_in, sqft

LAYERS = {
    "A-PLOT": 3, "A-SETBACK": 8, "A-WALL": 7, "A-WALL-FILL": 8, "A-DOOR": 4,
    "A-GLAZ": 5, "A-ROOM-TEXT": 2, "A-DIMS": 1, "A-NOTE": 7,
}
DISCLAIMER = ("CONCEPT DRAWING ONLY - NOT FOR CONSTRUCTION OR APPROVAL. Structural design and "
              "sanction drawings require a licensed architect/engineer.")


def export_dxf(model: BuildingModel) -> bytes:
    doc = ezdxf.new("R2018", setup=True)
    doc.units = ezdxf.units.MM
    for name, color in LAYERS.items():
        doc.layers.add(name, color=color)
    doc.layers.get("A-SETBACK").dxf.linetype = "DASHED"
    msp = doc.modelspace()

    plot = model.plot.polygon
    msp.add_lwpolyline(plot, close=True, dxfattribs={"layer": "A-PLOT"})
    sb = model.plot.setbacks
    xs, ys = [p[0] for p in plot], [p[1] for p in plot]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    msp.add_lwpolyline(
        [(x0 + sb.left, y0 + sb.front), (x1 - sb.right, y0 + sb.front),
         (x1 - sb.right, y1 - sb.rear), (x0 + sb.left, y1 - sb.rear)],
        close=True, dxfattribs={"layer": "A-SETBACK"},
    )

    floor = model.floors[0]
    walls = {w.id: w for w in floor.walls}
    solids = unary_union([
        Polygon(span_rect(w, s0, s1)) for w in floor.walls for s0, s1 in solid_spans(w, floor.openings)
    ])
    for poly in getattr(solids, "geoms", [solids]):
        hatch = msp.add_hatch(color=8, dxfattribs={"layer": "A-WALL-FILL"})
        hatch.paths.add_polyline_path(list(poly.exterior.coords), is_closed=True)
        msp.add_lwpolyline(list(poly.exterior.coords), close=True, dxfattribs={"layer": "A-WALL"})
        for ring in poly.interiors:
            hatch.paths.add_polyline_path(list(ring.coords), is_closed=True)
            msp.add_lwpolyline(list(ring.coords), close=True, dxfattribs={"layer": "A-WALL"})

    for o in floor.openings:
        w = walls[o.wall]
        h = w.thickness / 2
        if o.kind == "door":
            (ux, uy), _ = wall_frame(w)
            hinge = point_on_wall(w, o.offset, h * o.side)
            leaf_end = point_on_wall(w, o.offset, (h + o.width) * o.side)
            msp.add_line(hinge, leaf_end, dxfattribs={"layer": "A-DOOR"})
            start = degrees(atan2(uy, ux))
            normal = degrees(atan2(leaf_end[1] - hinge[1], leaf_end[0] - hinge[0]))
            a0, a1 = (start, normal) if o.side == 1 else (normal, start)
            msp.add_arc(hinge, o.width, a0, a1, dxfattribs={"layer": "A-DOOR"})
        elif o.kind in ("window", "ventilator"):
            for k in (-h, 0, h):
                msp.add_line(point_on_wall(w, o.offset, k), point_on_wall(w, o.offset + o.width, k),
                             dxfattribs={"layer": "A-GLAZ"})

    for room in floor.rooms:
        rx = [p[0] for p in room.polygon]
        ry = [p[1] for p in room.polygon]
        cx, cy = sum(rx) / len(rx), sum(ry) / len(ry)
        size = f"{format_ft_in(max(rx) - min(rx))} x {format_ft_in(max(ry) - min(ry))}"
        for text, dy, height in ((room.name.upper(), 250, 230), (size, -150, 160),
                                 (f"{sqft(room.area):.0f} sq ft", -450, 140)):
            msp.add_text(text, height=height, dxfattribs={"layer": "A-ROOM-TEXT"}).set_placement(
                (cx, cy + dy), align=TextEntityAlignment.MIDDLE_CENTER)

    dims = {"dimtxt": 250, "dimasz": 200, "dimexo": 100}
    msp.add_linear_dim(base=(x0, y0 - 1500), p1=(x0, y0), p2=(x1, y0), text=format_ft_in(x1 - x0),
                       dimstyle="EZDXF", override=dims, dxfattribs={"layer": "A-DIMS"}).render()
    msp.add_linear_dim(base=(x0 - 1500, y0), p1=(x0, y0), p2=(x0, y1), angle=90,
                       text=format_ft_in(y1 - y0), dimstyle="EZDXF", override=dims,
                       dxfattribs={"layer": "A-DIMS"}).render()

    road = ", ".join(s.title() for s in model.plot.road_sides)
    msp.add_text(f"ROAD ({road.upper()})", height=350, dxfattribs={"layer": "A-NOTE"}).set_placement(
        ((x0 + x1) / 2, y0 - 2600), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text(f"{model.name}  |  {DISCLAIMER}", height=150, dxfattribs={"layer": "A-NOTE"}).set_placement(
        (x0, y0 - 3400))

    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")
