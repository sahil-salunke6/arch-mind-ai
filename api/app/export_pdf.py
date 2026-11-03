"""A3 concept drawing set at 1:100: plan sheet, then elevations + section sheet."""

import io
from datetime import date
from math import atan2, degrees, radians, sin, cos

from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from shapely.geometry import Polygon
from shapely.ops import unary_union

from .geometry import (
    bbox, footprint, outward_normal, point_on_wall, solid_spans, span_rect, stair_layout, wall_frame,
)
from .model import BuildingModel, Floor, Opening
from .units import format_ft_in as fi
from .units import sqft

PAGE_W, PAGE_H = landscape(A3)
SCALE = 100
MARGIN = 10 * mm
COLUMN = 98 * mm  # right-hand column for tables + title block
INK = (0.11, 0.10, 0.18)
GREY = (0.55, 0.55, 0.6)
BRAND = (0.40, 0.27, 0.93)
ROOM_FILL = {
    "bedroom": (1.0, 0.95, 0.90), "toilet": (0.90, 0.95, 0.99), "kitchen": (1.0, 0.98, 0.92),
    "living": (0.99, 0.97, 0.94), "stair": (0.95, 0.95, 0.96), "parking": (0.94, 0.94, 0.94),
    "foyer": (0.98, 0.96, 0.93),
}
DISCLAIMER = (
    "CONCEPT DRAWING ONLY. Not for construction or statutory approval. Structural design, "
    "services and sanction drawings must be prepared and certified by a licensed architect/engineer."
)
PREFIX = {"door": "D", "window": "W", "ventilator": "V", "opening": "O"}
KIND_NAME = {"door": "Door", "window": "Window", "ventilator": "Ventilator", "opening": "Opening"}


def export_pdf(model: BuildingModel) -> bytes:
    buf = io.BytesIO()
    c = Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle(f"{model.name} - Concept Drawings")
    c.setAuthor("ArchMind AI")
    codes, schedule = opening_schedule(model.floors[0])
    _plan_sheet(c, model, codes, schedule)
    c.showPage()
    _elevation_sheet(c, model)
    c.showPage()
    c.save()
    return buf.getvalue()


# ---------------------------------------------------------------- helpers

def opening_schedule(floor: Floor) -> tuple[dict[str, str], list[dict]]:
    """Group identical openings into codes D1, W1, ... and count them."""
    groups: dict[tuple, dict] = {}
    codes: dict[str, str] = {}
    order = {"door": 0, "opening": 1, "window": 2, "ventilator": 3}
    for o in sorted(floor.openings, key=lambda o: (order[o.kind], -o.width, -o.height)):
        key = (o.kind, round(o.width), round(o.height), round(o.sill))
        if key not in groups:
            n = sum(k[0] == o.kind for k in groups) + 1
            groups[key] = {"code": f"{PREFIX[o.kind]}{n}", "kind": o.kind, "width": o.width,
                           "height": o.height, "sill": o.sill, "count": 0}
        groups[key]["count"] += 1
        codes[o.id] = groups[key]["code"]
    return codes, list(groups.values())


def compass(model: BuildingModel, side: str) -> tuple[float, float]:
    a = radians(model.north_deg + {"north": 0, "east": 90, "south": 180, "west": 270}[side])
    return sin(a), cos(a)


class View:
    """Model millimetres → page points at 1:SCALE; (ox, oy) is where model (x0, y0) lands."""

    def __init__(self, c: Canvas, ox: float, oy: float, x0: float = 0, y0: float = 0):
        self.c, self.ox, self.oy, self.x0, self.y0 = c, ox, oy, x0, y0

    def p(self, x: float, y: float) -> tuple[float, float]:
        return self.ox + (x - self.x0) / SCALE * mm, self.oy + (y - self.y0) / SCALE * mm

    def poly(self, pts, stroke=1, fill=0):
        path = self.c.beginPath()
        path.moveTo(*self.p(*pts[0]))
        for pt in pts[1:]:
            path.lineTo(*self.p(*pt))
        path.close()
        self.c.drawPath(path, stroke=stroke, fill=fill)

    def rect(self, x0, y0, x1, y1, stroke=1, fill=0):
        self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], stroke, fill)

    def line(self, a, b):
        self.c.line(*self.p(*a), *self.p(*b))

    def text(self, x, y, s, size=6.5, font="Helvetica", align="c"):
        self.c.setFont(font, size)
        px, py = self.p(x, y)
        {"c": self.c.drawCentredString, "l": self.c.drawString, "r": self.c.drawRightString}[align](px, py, s)


def _style(c: Canvas, width=0.5, stroke=INK, fill=None, dash=None):
    c.setLineWidth(width)
    c.setStrokeColorRGB(*stroke)
    if fill:
        c.setFillColorRGB(*fill)
    c.setDash(*(dash or ([], 0)))


def _dim_chain(v: View, stations: list[float], at: float, horizontal: bool, text_size=5.5):
    """Architectural dimension chain with slash ticks and ft-in text per segment."""
    c = v.c
    _style(c, 0.35, fill=INK)
    pt = (lambda s: (s, at)) if horizontal else (lambda s: (at, s))
    v.line(pt(stations[0]), pt(stations[-1]))
    for s in stations:
        x, y = v.p(*pt(s))
        c.line(x - 1.2, y - 1.2, x + 1.2, y + 1.2)
        ext = (0, 1.6) if horizontal else (1.6, 0)
        c.line(x - ext[0], y - ext[1], x + ext[0], y + ext[1])
    for a, b in zip(stations, stations[1:]):
        if (b - a) / SCALE < 4.5:  # under 4.5 mm on paper: no room for text
            continue
        x, y = v.p(*pt((a + b) / 2))
        c.setFont("Helvetica", text_size)
        if horizontal:
            c.drawCentredString(x, y + 1.3, fi(b - a))
        else:
            c.saveState()
            c.translate(x - 1.3, y)
            c.rotate(90)
            c.drawCentredString(0, 0, fi(b - a))
            c.restoreState()


def _table(c: Canvas, x: float, y: float, widths: list[float], header: list[str], rows: list[list[str]],
           title: str) -> float:
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, title)
    y -= 4 * mm
    row_h = 4.2 * mm
    total = sum(widths)
    for i, row in enumerate([header] + rows):
        if i == 0:
            c.setFillColorRGB(0.93, 0.91, 1.0)
            c.rect(x, y - row_h + 1.2 * mm, total, row_h, stroke=0, fill=1)
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 6.5)
        cx = x + 1.2 * mm
        for j, (cell, w) in enumerate(zip(row, widths)):
            if j == len(widths) - 1:
                c.drawRightString(cx + w - 2.4 * mm, y, cell)
            else:
                c.drawString(cx, y, cell)
            cx += w
        y -= row_h
        c.setStrokeColorRGB(0.85, 0.85, 0.9)
        c.setLineWidth(0.3)
        c.line(x, y + 2.8 * mm, x + total, y + 2.8 * mm)
    return y - 3 * mm


def _title_block(c: Canvas, model: BuildingModel, drawing: str, sheet: str):
    x0 = PAGE_W - MARGIN - COLUMN
    h = 62 * mm
    _style(c, 0.8)
    c.rect(x0, MARGIN, COLUMN, h)
    # disclaimer band
    c.setFillColorRGB(1.0, 0.95, 0.93)
    c.rect(x0, MARGIN, COLUMN, 14 * mm, stroke=1, fill=1)
    c.setFillColorRGB(0.62, 0.16, 0.1)
    text = c.beginText(x0 + 2.5 * mm, MARGIN + 10.5 * mm)
    text.setFont("Helvetica-Bold", 5.6)
    for line in _wrap(DISCLAIMER, 92):
        text.textLine(line)
    c.drawText(text)

    rows = [
        ("PROJECT", model.name),
        ("DRAWING", drawing),
        ("FACING", ", ".join(s.title() for s in model.plot.road_sides) + " (road side)"),
        ("SCALE", f"1:{SCALE} @ A3"),
        ("DATE", date.today().strftime("%d %b %Y")),
    ]
    y = MARGIN + 14 * mm
    for label, value in reversed(rows):
        c.setStrokeColorRGB(0.8, 0.8, 0.85)
        c.setLineWidth(0.3)
        c.line(x0, y, x0 + COLUMN, y)
        c.setFillColorRGB(*GREY)
        c.setFont("Helvetica", 5.5)
        c.drawString(x0 + 2.5 * mm, y + 2.2 * mm, label)
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(x0 + 20 * mm, y + 2 * mm, value)
        y += 6.5 * mm
    # brand + sheet number
    c.setFillColorRGB(*BRAND)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(x0 + 2.5 * mm, MARGIN + h - 8 * mm, "ArchMind AI")
    c.setFillColorRGB(*GREY)
    c.setFont("Helvetica", 6)
    c.drawString(x0 + 2.5 * mm, MARGIN + h - 11.5 * mm, "AI-assisted concept design")
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 18)
    c.drawRightString(x0 + COLUMN - 3 * mm, MARGIN + h - 10 * mm, sheet)


def _wrap(s: str, width: int) -> list[str]:
    lines, cur = [], ""
    for word in s.split():
        if len(cur) + len(word) + 1 > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    return lines + [cur]


def _frame(c: Canvas):
    _style(c, 1.2)
    c.rect(MARGIN / 2, MARGIN / 2, PAGE_W - MARGIN, PAGE_H - MARGIN)


def _caption(c: Canvas, x: float, y: float, title: str, sub: str = f"Scale 1:{SCALE}"):
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x, y, title)
    w = c.stringWidth(title, "Helvetica-Bold", 9)
    _style(c, 0.6)
    c.line(x - w / 2, y - 1.5, x + w / 2, y - 1.5)
    c.setFont("Helvetica", 6.5)
    c.drawCentredString(x, y - 4.5 * mm, sub)


def section_line_y(floor: Floor) -> float:
    """Cut through the stair's first flight when there is one, else through the middle."""
    stair = next((r for r in floor.rooms if r.type == "stair"), None)
    if stair:
        x0, y0, x1, y1 = bbox(stair.polygon)
        if x1 - x0 >= y1 - y0:
            return y0 + (y1 - y0) / 4
    _, fy0, _, fy1 = footprint(floor)
    return (fy0 + fy1) / 2


# ---------------------------------------------------------------- sheet 1: plan

def _plan_sheet(c: Canvas, model: BuildingModel, codes: dict[str, str], schedule: list[dict]):
    _frame(c)
    floor = model.floors[0]
    px0, py0, px1, py1 = bbox(model.plot.polygon)
    sb = model.plot.setbacks
    pad_l, pad_r, pad_b, pad_t = 4200, 2600, 4600, 4400
    area_w = PAGE_W - 2 * MARGIN - COLUMN - 6 * mm
    area_h = PAGE_H - 2 * MARGIN - 8 * mm
    draw_w = (px1 - px0 + pad_l + pad_r) / SCALE * mm
    draw_h = (py1 - py0 + pad_b + pad_t) / SCALE * mm
    ox = MARGIN + (area_w - draw_w) / 2 + pad_l / SCALE * mm
    oy = MARGIN + 8 * mm + (area_h - draw_h) / 2 + pad_b / SCALE * mm
    v = View(c, ox, oy, px0, py0)

    # road
    _style(c, 0.4, fill=(0.88, 0.88, 0.9))
    v.rect(px0 - 1500, py0 - 3200, px1 + 1500, py0 - 900, stroke=0, fill=1)
    c.setFillColorRGB(*INK)
    road = ", ".join(s.title() for s in model.plot.road_sides)
    width = f" - {fi(model.plot.road_width)} wide" if model.plot.road_width else ""
    v.text((px0 + px1) / 2, py0 - 2200, f"ROAD ({road.upper()}){width}", 8, "Helvetica-Bold")

    # plot, setback line, rooms
    _style(c, 1.0, stroke=(0.3, 0.45, 0.25), fill=(0.95, 0.98, 0.93))
    v.poly(model.plot.polygon, stroke=1, fill=1)
    if model.plot.gate:
        gx, gw = model.plot.gate
        _style(c, 2.4, stroke=(1, 1, 1))
        v.line((gx, py0), (gx + gw, py0))
        c.setFillColorRGB(*INK)
        v.text(gx + gw / 2, py0 - 600, f"MAIN GATE {fi(gw)}", 5.5)
    _style(c, 0.5, stroke=GREY, dash=([4, 2.5], 0))
    v.rect(px0 + sb.left, py0 + sb.front, px1 - sb.right, py1 - sb.rear)
    for room in floor.rooms:
        _style(c, 0, fill=ROOM_FILL.get(room.type, (0.97, 0.97, 0.97)))
        v.poly(room.polygon, stroke=0, fill=1)

    # stair treads
    for room in (r for r in floor.rooms if r.type == "stair"):
        _style(c, 0.35, stroke=GREY)
        treads = stair_layout(room, floor.height)
        for (x0, y0, x1, y1), _, _ in treads:
            v.rect(x0, y0, x1, y1)
        (ax0, ay0, ax1, ay1), _, _ = treads[0]
        (bx0, _, bx1, _), _, _ = treads[len(treads) // 2 - 1]
        mid = (ay0 + ay1) / 2
        _style(c, 0.5)
        v.line(((ax0 + ax1) / 2, mid), ((bx0 + bx1) / 2, mid))
        c.setFillColorRGB(*INK)
        v.text((ax0 + ax1) / 2 - 150, mid + 120, "UP", 5, "Helvetica-Bold", "r")

    # walls
    solids = unary_union([Polygon(span_rect(w, s0, s1)) for w in floor.walls for s0, s1 in solid_spans(w, floor.openings)])
    _style(c, 0.6, fill=(0.17, 0.16, 0.22))
    for poly in getattr(solids, "geoms", [solids]):
        v.poly(list(poly.exterior.coords)[:-1], stroke=1, fill=1)

    # openings
    fx0, fy0, fx1, fy1 = footprint(floor)
    center = ((fx0 + fx1) / 2, (fy0 + fy1) / 2)
    walls = {w.id: w for w in floor.walls}
    for o in floor.openings:
        w = walls[o.wall]
        h = w.thickness / 2
        if o.kind in ("window", "ventilator"):
            _style(c, 0.3, fill=(1, 1, 1))
            v.poly(span_rect(w, o.offset, o.offset + o.width), stroke=1, fill=1)
            _style(c, 0.3)
            for k in (-h / 3, h / 3):
                v.line(point_on_wall(w, o.offset, k), point_on_wall(w, o.offset + o.width, k))
        elif o.kind == "door":
            (ux, uy), (nx, ny) = wall_frame(w)
            hinge = point_on_wall(w, o.offset, h * o.side)
            leaf = point_on_wall(w, o.offset, (h + o.width) * o.side)
            _style(c, 0.9)
            v.line(hinge, leaf)
            a_u = degrees(atan2(uy, ux))
            a_leaf = degrees(atan2(ny * o.side, nx * o.side))
            extent = (a_leaf - a_u + 180) % 360 - 180
            hx, hy = v.p(*hinge)
            r = o.width / SCALE * mm
            _style(c, 0.3, dash=([1.5, 1], 0))
            c.arc(hx - r, hy - r, hx + r, hy + r, a_u, extent)
            _style(c, 0.3)
        # tag
        if w.type == "exterior":
            nx, ny = outward_normal(w, center)
            k_sign = 1 if wall_frame(w)[1] == (nx, ny) else -1
        else:
            k_sign = -o.side
        tx, ty = point_on_wall(w, o.offset + o.width / 2, k_sign * (h + 330))
        c.setFillColorRGB(*BRAND)
        v.text(tx, ty - 60, codes[o.id], 5, "Helvetica-Bold")

    # labels
    c.setFillColorRGB(*INK)
    for room in floor.rooms:
        x0, y0, x1, y1 = bbox(room.polygon)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        small = min(x1 - x0, y1 - y0) < 2400
        if room.type == "stair":
            cy = y1 - 500
        v.text(cx, cy + 120, room.name.upper(), 5.2 if small else 6.5, "Helvetica-Bold")
        v.text(cx, cy - 280, f"{fi(x1 - x0)} x {fi(y1 - y0)}", 4.8 if small else 5.8)

    # dimensions: plot overall + building chains
    vert = sorted({w.a[0] for w in floor.walls if abs(w.a[0] - w.b[0]) < 1 and max(w.a[1], w.b[1]) >= fy1 - 400})
    horiz = sorted({w.a[1] for w in floor.walls if abs(w.a[1] - w.b[1]) < 1 and min(w.a[0], w.b[0]) <= fx0 + 400})
    _dim_chain(v, [px0, px1], py1 + 2600, True, 6.5)
    _dim_chain(v, [px0] + vert + [px1], py1 + 1300, True)
    _dim_chain(v, [py0, py1], px0 - 2900, False, 6.5)
    _dim_chain(v, [py0] + horiz + [py1], px0 - 1500, False)

    # section marker A-A
    ys = section_line_y(floor)
    _style(c, 0.6, stroke=BRAND, dash=([6, 2, 1, 2], 0))
    v.line((px0 - 700, ys), (px1 + 700, ys))
    _style(c, 0.6, stroke=BRAND, fill=(1, 1, 1))
    for x in (px0 - 1200, px1 + 1200):
        cx, cy = v.p(x, ys)
        c.circle(cx, cy, 2.6 * mm, stroke=1, fill=1)
        c.setFillColorRGB(*BRAND)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(cx, cy - 2.4, "A")
        path = c.beginPath()
        path.moveTo(cx - 1.6 * mm, cy + 2.8 * mm)
        path.lineTo(cx + 1.6 * mm, cy + 2.8 * mm)
        path.lineTo(cx, cy + 5.2 * mm)
        path.close()
        c.drawPath(path, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1)

    _north_arrow(c, v.p(px1 + 1500, py1 + 2600), model.north_deg)
    _caption(c, MARGIN + area_w / 2, MARGIN + 9 * mm, "GROUND FLOOR PLAN")

    # right column
    x = PAGE_W - MARGIN - COLUMN
    y = PAGE_H - MARGIN - 6 * mm
    plot_area = Polygon(model.plot.polygon).area
    built = (fx1 - fx0) * (fy1 - fy0)
    carpet = sum(r.area for r in floor.rooms)
    y = _table(c, x, y, [58 * mm, 40 * mm], ["Item", "Area"], [
        ["Plot area", f"{sqft(plot_area):,.0f} sq ft ({plot_area / 1e6:.1f} m²)"],
        ["Built-up area (ground floor)", f"{sqft(built):,.0f} sq ft"],
        ["Ground coverage", f"{built / plot_area * 100:.1f} %"],
        ["Carpet area (rooms)", f"{sqft(carpet):,.0f} sq ft"],
        ["Setbacks F / R / L / R", " / ".join(fi(s) for s in (sb.front, sb.rear, sb.left, sb.right))],
    ], "AREA STATEMENT")
    y = _table(c, x, y, [40 * mm, 32 * mm, 26 * mm], ["Room", "Size", "Area"], [
        [r.name, " x ".join(fi(d) for d in _size(r.polygon)), f"{sqft(r.area):.0f} sq ft"] for r in floor.rooms
    ], "ROOM SCHEDULE")
    y = _table(c, x, y, [12 * mm, 22 * mm, 30 * mm, 20 * mm, 14 * mm], ["Code", "Type", "Size (W x H)", "Sill", "Nos"], [
        [g["code"], KIND_NAME[g["kind"]], f"{fi(g['width'])} x {fi(g['height'])}", fi(g["sill"]) if g["sill"] else "-",
         str(g["count"])] for g in schedule
    ], "DOOR & WINDOW SCHEDULE")
    _notes(c, x, y, [
        "All dimensions in feet-inches unless noted. Do not scale.",
        "External walls 9\" brick, internal walls 4.5\" brick.",
        f"Floor-to-floor height {fi(floor.height)}; plinth {fi(floor.plinth)} above ground.",
        "Room sizes are centre-line dimensions.",
    ])
    _title_block(c, model, "Ground Floor Plan", "A-101")


def _size(pts) -> tuple[float, float]:
    x0, y0, x1, y1 = bbox(pts)
    return x1 - x0, y1 - y0


def _notes(c: Canvas, x: float, y: float, lines: list[str]):
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, "NOTES")
    c.setFont("Helvetica", 6.3)
    for i, line in enumerate(lines):
        c.drawString(x, y - (4 + i * 3.4) * mm, f"{i + 1}. {line}")


def _north_arrow(c: Canvas, at: tuple[float, float], north_deg: float):
    x, y = at
    c.saveState()
    c.translate(x, y)
    _style(c, 0.6, fill=(1, 1, 1))
    c.circle(0, 0, 5 * mm, stroke=1, fill=1)
    c.rotate(-north_deg)  # north_deg is clockwise; reportlab rotates counter-clockwise
    c.setFillColorRGB(*INK)
    path = c.beginPath()
    path.moveTo(0, 4.2 * mm)
    path.lineTo(1.8 * mm, -2.5 * mm)
    path.lineTo(0, -1.2 * mm)
    path.lineTo(-1.8 * mm, -2.5 * mm)
    path.close()
    c.drawPath(path, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(0, 6.2 * mm, "N")
    c.restoreState()


# ---------------------------------------------------------------- sheet 2: elevations + section

def _elevation_items(model: BuildingModel):
    floor = model.floors[0]
    fx0, fy0, fx1, fy1 = footprint(floor)
    corners = [(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)]
    center = ((fx0 + fx1) / 2, (fy0 + fy1) / 2)
    items = []
    road = model.plot.road_sides
    for side in ("east", "west", "north", "south"):
        dx, dy = compass(model, side)  # from building towards the viewer
        rx, ry = -dy, dx  # viewer faces (-dx, -dy); screen-right is that direction turned clockwise
        proj = lambda p: (p[0] - center[0]) * rx + (p[1] - center[1]) * ry  # noqa: E731
        us = [proj(p) for p in corners]
        openings = []
        for w in (w for w in floor.walls if w.type == "exterior"):
            nx, ny = outward_normal(w, center)
            if nx * dx + ny * dy < 0.7:
                continue
            for o in (o for o in floor.openings if o.wall == w.id):
                a, b = proj(point_on_wall(w, o.offset)), proj(point_on_wall(w, o.offset + o.width))
                openings.append((min(a, b), max(a, b), o))
        title = f"{side.upper()} ELEVATION" + (" (FRONT)" if side in road else "")
        items.append({"title": title, "u0": min(us), "u1": max(us), "openings": openings, "kind": "elev"})
    return items


def _elevation_sheet(c: Canvas, model: BuildingModel):
    _frame(c)
    floor = model.floors[0]
    total_h = floor.plinth + floor.height + floor.slab + model.roof.parapet
    fx0, _, fx1, _ = footprint(floor)
    items = _elevation_items(model)
    items.append({"title": "SECTION A-A", "u0": fx0, "u1": fx1, "kind": "section"})

    # first-fit packing into rows across the full sheet width (tables sit below the drawings)
    area_w = PAGE_W - 2 * MARGIN - 10 * mm
    gap = 10 * mm
    rows: list[list[tuple[dict, float]]] = []
    for it in items:
        w = (it["u1"] - it["u0"] + 2600) / SCALE * mm
        row = next((r for r in rows if sum(x for _, x in r) + gap * len(r) + w <= area_w), None)
        if row is None:
            rows.append(row := [])
        row.append((it, w))
    row_h = (total_h + 2800) / SCALE * mm + 14 * mm
    top = PAGE_H - MARGIN - 8 * mm
    for r_i, row in enumerate(rows):
        used = sum(w for _, w in row) + gap * (len(row) - 1)
        x = MARGIN + 5 * mm + (area_w - used) / 2
        base_y = top - (r_i + 1) * row_h + 16 * mm
        for it, w in row:
            v = View(c, x + 1300 / SCALE * mm, base_y, it["u0"], 0)
            if it["kind"] == "elev":
                _draw_elevation(v, model, it)
            else:
                _draw_section(v, model)
            _caption(c, x + w / 2, base_y - 9 * mm, it["title"])
            x += w + gap

    y = MARGIN + 58 * mm
    levels = [
        ("Ground level (GL)", 0), ("Plinth / floor level", floor.plinth),
        ("Roof slab top", floor.plinth + floor.height + floor.slab), ("Parapet top", total_h),
    ]
    _table(c, MARGIN + 5 * mm, y, [55 * mm, 38 * mm], ["Level", "Height above GL"],
           [[n, f"+{fi(h)} ({h / 1000:.2f} m)"] for n, h in levels], "LEVELS")
    _notes(c, MARGIN + 110 * mm, y, [
        "External finish: cement plaster with exterior emulsion paint.",
        "Windows: aluminium/uPVC sliding with RCC chajja above.",
        "Roof: RCC flat slab with waterproofing and parapet.",
        "Structure (RCC frame, footings) by a licensed structural engineer.",
        "Compound wall and gate not shown in elevations.",
    ])
    _title_block(c, model, "Elevations & Section", "A-201")


def _levels_and_ground(v: View, model: BuildingModel, u0: float, u1: float):
    floor = model.floors[0]
    c = v.c
    _style(c, 1.4)
    v.line((u0 - 1200, 0), (u1 + 1200, 0))
    _style(c, 0.25, stroke=GREY)
    for i in range(int((u1 - u0 + 2400) / 400)):
        x = u0 - 1200 + i * 400
        v.line((x, 0), (x - 250, -250))
    total = floor.plinth + floor.height + floor.slab + model.roof.parapet
    c.setFillColorRGB(*GREY)
    for h in (0, floor.plinth, floor.plinth + floor.height + floor.slab, total):
        _style(c, 0.3, stroke=GREY, dash=([1.5, 1.5], 0))
        v.line((u1 + 200, h), (u1 + 1300, h))
        c.setFillColorRGB(*GREY)
        v.text(u1 + 1350, h + 60, f"+{fi(h)}", 5, align="l")


def _draw_elevation(v: View, model: BuildingModel, it: dict):
    c = v.c
    floor = model.floors[0]
    u0, u1 = it["u0"], it["u1"]
    pl, H, slab, par = floor.plinth, floor.height, floor.slab, model.roof.parapet
    _levels_and_ground(v, model, u0, u1)
    # plinth, wall, slab band, parapet
    _style(c, 0.6, fill=(0.82, 0.80, 0.76))
    v.rect(u0, 0, u1, pl, fill=1)
    _style(c, 0.8, fill=(0.97, 0.96, 0.93))
    v.rect(u0, pl, u1, pl + H, fill=1)
    _style(c, 0.6, fill=(0.88, 0.87, 0.84))
    v.rect(u0 - 150, pl + H, u1 + 150, pl + H + slab, fill=1)
    _style(c, 0.6, fill=(0.95, 0.94, 0.91))
    v.rect(u0 - 75, pl + H + slab, u1 + 75, pl + H + slab + par, fill=1)
    for a, b, o in it["openings"]:
        _draw_opening_elev(v, a, b, o, pl)


def _draw_opening_elev(v: View, a: float, b: float, o: Opening, pl: float):
    c = v.c
    z0, z1 = pl + o.sill, pl + o.sill + o.height
    if o.kind in ("window", "ventilator"):
        _style(c, 0.5, fill=(0.82, 0.90, 0.97))
        v.rect(a, z0, b, z1, fill=1)
        _style(c, 0.35)
        v.line(((a + b) / 2, z0), ((a + b) / 2, z1))
        v.rect(a + 50, z0 + 50, b - 50, z1 - 50)
        _style(c, 0.4, fill=(0.80, 0.78, 0.74))
        v.rect(a - 150, z1 + 50, b + 150, z1 + 130, fill=1)  # chajja
    elif o.kind == "door":
        _style(c, 0.5, fill=(0.82, 0.68, 0.55))
        v.rect(a, pl, b, z1, fill=1)
        _style(c, 0.3)
        v.rect(a + 120, pl + 150, b - 120, pl + (z1 - pl) * 0.5)
        v.rect(a + 120, pl + (z1 - pl) * 0.55, b - 120, z1 - 150)
        _style(c, 0.4, fill=(0.80, 0.78, 0.74))
        v.rect(a - 150, z1 + 50, b + 150, z1 + 130, fill=1)
    else:  # open bay (e.g. parking)
        _style(c, 0.5, fill=(0.42, 0.42, 0.46))
        v.rect(a, pl, b, z1, fill=1)
        _style(c, 0.6, fill=(0.80, 0.78, 0.74))
        v.rect(a - 75, z1, b + 75, z1 + 230, fill=1)  # beam


def _draw_section(v: View, model: BuildingModel):
    """Section along y = A-A, looking away from the road (screen-right = +x)."""
    c = v.c
    floor = model.floors[0]
    pl, H, slab, par = floor.plinth, floor.height, floor.slab, model.roof.parapet
    fx0, _, fx1, _ = footprint(floor)
    ys = section_line_y(floor)
    _levels_and_ground(v, model, fx0, fx1)

    _style(c, 0.5, fill=(0.85, 0.84, 0.80))
    v.rect(fx0, 0, fx1, pl, fill=1)  # plinth fill
    # stair profile
    for room in (r for r in floor.rooms if r.type == "stair"):
        for (x0, y0, x1, y1), top, _ in stair_layout(room, H):
            if y0 <= ys <= y1:
                _style(c, 0.35, fill=(0.78, 0.77, 0.74))
                v.rect(x0, pl, x1, pl + top, fill=1)
    # room names
    c.setFillColorRGB(*GREY)
    for room in floor.rooms:
        x0, y0, x1, y1 = bbox(room.polygon)
        if y0 <= ys <= y1:
            v.text((x0 + x1) / 2, pl + H * 0.72, room.name.upper(), 5.5, "Helvetica-Bold")
    # cut walls (perpendicular to the section line)
    cut = (0.12, 0.11, 0.16)
    for w in floor.walls:
        (ux, uy), _ = wall_frame(w)
        if abs(uy) < 0.5 or not (min(w.a[1], w.b[1]) <= ys <= max(w.a[1], w.b[1])):
            continue
        s = (ys - w.a[1]) / uy
        x = w.a[0] + ux * s
        t = w.thickness / 2
        hit = next((o for o in floor.openings if o.wall == w.id and o.offset <= s <= o.offset + o.width), None)
        _style(c, 0.4, fill=cut)
        if hit is None:
            v.rect(x - t, pl, x + t, pl + H, fill=1)
        else:
            if hit.sill > 0:
                v.rect(x - t, pl, x + t, pl + hit.sill, fill=1)
            v.rect(x - t, pl + hit.sill + hit.height, x + t, pl + H, fill=1)
    # roof slab + parapets
    _style(c, 0.4, fill=cut)
    v.rect(fx0 - 150, pl + H, fx1 + 150, pl + H + slab, fill=1)
    v.rect(fx0 - 75, pl + H + slab, fx0 + 40, pl + H + slab + par, fill=1)
    v.rect(fx1 - 40, pl + H + slab, fx1 + 75, pl + H + slab + par, fill=1)
    # floor-to-ceiling dimension
    _dim_chain(v, [pl, pl + H], fx0 - 700, False)
