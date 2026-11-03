"""Hand-drawn sketch → BuildingModel.

Pipeline: flatten photo → ink mask → OCR labels → pen strokes → snap strokes to a grid of "stations"
→ solve real station positions from the written sizes (least squares) → walls, doors, plot, rooms.

Sketches are never to scale, so written numbers win over drawn proportions: drawn proportions only
fill in where nothing is written. Where the numbers contradict each other we report it.
"""

import base64
from dataclasses import dataclass, field
from statistics import median

import cv2
import numpy as np
from shapely.geometry import Point as ShPoint
from shapely.geometry import Polygon

from ..model import BuildingModel, Floor, Opening, Plot, Setbacks, Wall
from ..rooms import detect_rooms
from ..sample import sample_project
from ..units import MM_PER_FT, format_ft_in as fi
from .image import flatten_page, ink_mask, load
from .lines import Seg, find_strokes
from .text import Label, classify, read_text

EXT, INT = 0.75 * MM_PER_FT, 115.0
DOOR_GAP = (600, 1600)  # mm: a gap this wide in a wall line is a doorway
TOLERANCE = 6 * 25.4  # report written sizes the solved plan misses by more than 6"
SIDE_NORTH = {"north": 180, "east": 90, "south": 0, "west": 270}  # road drawn at the bottom


@dataclass
class SketchResult:
    model: BuildingModel
    warnings: list[str]
    overlay: dict
    stats: dict = field(default_factory=dict)


class SketchError(ValueError):
    pass


def read_sketch(data: bytes, name: str = "Sketch") -> SketchResult:
    img, warped = flatten_page(load(data))
    mask = ink_mask(img)
    labels = classify(read_text(img))
    strokes = find_strokes(mask, [lb.poly for lb in labels])
    if len(strokes.walls) < 3:
        raise SketchError("No walls found. Draw walls as clear straight lines with a dark pen and photograph the whole page.")
    L = max(img.shape[:2])
    warnings: list[str] = []

    grid = _Grid(strokes.walls, strokes.plot, tol=0.009 * L)
    snapped = grid.snap_walls(strokes.walls, min_len=0.012 * L)
    # pass 1: judge doorway gaps in pixels to get a first scale; pass 2: judge them in real sizes
    walls_px = _close_gaps(snapped, grid, max_gap=0.07 * L, max_outer_gap=0.13 * L)
    rough = _constraints(labels, grid, walls_px, strokes.plot)
    if rough:
        mm_per_px = float(median(c.value / c.px for c in rough))
        walls_px = _close_gaps(snapped, grid, max_gap=1700 / mm_per_px, max_outer_gap=14 * MM_PER_FT / mm_per_px)
    constraints = _constraints(labels, grid, walls_px, strokes.plot)
    scale = _scale(constraints, grid, warnings)
    X, Y = _solve(grid, constraints, scale)
    for c in constraints:
        got = (X if c.axis == "x" else Y)[c.j] - (X if c.axis == "x" else Y)[c.i]
        if abs(got - c.value) > TOLERANCE:
            warnings.append(f"{c.what}: written {fi(c.value)}, but the drawing fits {fi(got)}. Check this size.")

    model, rooms_from = _build_model(name, grid, X, Y, walls_px, strokes, labels, constraints, warnings)
    warnings = list(dict.fromkeys(warnings))
    overlay = _overlay(img, grid, walls_px, strokes, labels)
    stats = {"walls": len(model.floors[0].walls), "rooms": len(model.floors[0].rooms),
             "labels_read": sum(lb.role != "note" for lb in labels), "sizes_used": len(constraints),
             "named_rooms": rooms_from, "page_flattened": warped, "wall_style": strokes.style}
    return SketchResult(model=model, warnings=warnings, overlay=overlay, stats=stats)


# --- grid ------------------------------------------------------------------------------------

class _Grid:
    """Wall positions and wall ends clustered into x and y stations (pixel positions)."""

    def __init__(self, walls: list[Seg], plot, tol: float):
        self.tol = tol
        xs = [(s.pos, 3.0) for s in walls if not s.horizontal] + [(v, 1.0) for s in walls if s.horizontal for v in (s.a, s.b)]
        ys = [(s.pos, 3.0) for s in walls if s.horizontal] + [(v, 1.0) for s in walls if not s.horizontal for v in (s.a, s.b)]
        if plot:
            xs += [(plot[0], 5.0), (plot[2], 5.0)]
            ys += [(plot[1], 5.0), (plot[3], 5.0)]
        self.x = self._cluster(xs)
        self.y = self._cluster(ys)
        self.plot = (self.xi(plot[0]), self.yi(plot[1]), self.xi(plot[2]), self.yi(plot[3])) if plot else None

    def _cluster(self, vals: list[tuple[float, float]]) -> list[float]:
        # compare against the group's running centre, not its last member, so that a row of
        # closely spaced walls doesn't chain into one station
        groups: list[list[tuple[float, float]]] = []
        centre = lambda g: sum(v * w for v, w in g) / sum(w for _, w in g)  # noqa: E731
        for v, w in sorted(vals):
            if groups and v - centre(groups[-1]) <= self.tol:
                groups[-1].append((v, w))
            else:
                groups.append([(v, w)])
        return [centre(g) for g in groups]

    def xi(self, v: float) -> int:
        return int(np.argmin([abs(v - x) for x in self.x]))

    def yi(self, v: float) -> int:
        return int(np.argmin([abs(v - y) for y in self.y]))

    def snap_walls(self, walls: list[Seg], min_len: float) -> list[tuple[bool, int, int, int, float]]:
        """(horizontal, line station, start station, end station, pen spacing) per wall."""
        out = set()
        for s in walls:
            if s.length < min_len:
                continue
            if s.horizontal:
                line, a, b = self.yi(s.pos), self.xi(s.a), self.xi(s.b)
            else:
                line, a, b = self.xi(s.pos), self.yi(s.a), self.yi(s.b)
            if a != b:
                out.add((s.horizontal, line, min(a, b), max(a, b), round(s.thick, 1)))
        return sorted(out)


DOOR = -1.0  # marks a doorway span in the wall list (in place of a pen spacing)


def _close_gaps(walls_px, grid: _Grid, max_gap: float, max_outer_gap: float):
    """Doorways: a short gap between two pieces of one wall line, or a wall end that stops just short
    of the next wall, become door spans so rooms close up. Outer walls also have wider openings
    (parking bays, sit-outs, windows drawn as gaps)."""
    out = set(walls_px)
    by_line: dict[tuple[bool, int], list] = {}
    for w in walls_px:
        by_line.setdefault((w[0], w[1]), []).append(w)
    outer_x = (min(w[1] for w in walls_px if not w[0]), max(w[1] for w in walls_px if not w[0]))
    outer_y = (min(w[1] for w in walls_px if w[0]), max(w[1] for w in walls_px if w[0]))
    for (hz, line), ws in by_line.items():
        st = grid.x if hz else grid.y
        limit = max_outer_gap if line in (outer_y if hz else outer_x) else max_gap
        ws.sort(key=lambda w: w[2])
        for p, q in zip(ws, ws[1:]):
            if q[2] > p[3] and st[q[2]] - st[p[3]] <= limit:
                out.add((hz, line, p[3], q[2], DOOR))

    def meets_wall(hz: bool, line: int, end: int) -> bool:
        return any(o[0] != hz and o[1] == end and o[2] <= line <= o[3] for o in out)

    def continues(hz: bool, line: int, end: int, w) -> bool:
        return any(o is not w and o[0] == hz and o[1] == line and o[2] <= end <= o[3] for o in out)

    for w in sorted(walls_px):
        hz, line, a, b, _ = w
        st = grid.x if hz else grid.y
        limit = max_outer_gap if line in (outer_y if hz else outer_x) else max_gap
        for end, direction in ((a, -1), (b, 1)):
            if meets_wall(hz, line, end) or continues(hz, line, end, w):
                continue
            reach = [o[1] for o in out if o[0] != hz and o[2] <= line <= o[3]
                     and 0 < direction * (st[o[1]] - st[end]) <= limit]
            if reach:
                stop = min(reach, key=lambda k: abs(st[k] - st[end]))
                out.add((hz, line, min(end, stop), max(end, stop), DOOR))
    return sorted(out)


# --- constraints from written sizes ---------------------------------------------------------

@dataclass
class _C:
    axis: str  # "x" or "y"
    i: int
    j: int
    value: float  # mm
    what: str
    px: float = 0.0
    weight: float = 1.0  # overall plot sizes and margins are usually written most carefully


def _covering(walls_px, grid: _Grid, horizontal: bool, at: float) -> list[int]:
    """Stations of wall lines (horizontal or vertical) whose extent covers pixel coordinate `at`."""
    stations = grid.x if horizontal else grid.y
    pad = grid.tol
    return sorted({line for hz, line, a, b, _ in walls_px if hz == horizontal and stations[a] - pad <= at <= stations[b] + pad})


def _enclosure(walls_px, grid: _Grid, cx: float, cy: float):
    """Nearest wall stations left/right/above/below a point, or None."""
    vs = _covering(walls_px, grid, False, cy)
    hs = _covering(walls_px, grid, True, cx)
    left = [i for i in vs if grid.x[i] < cx]
    right = [i for i in vs if grid.x[i] > cx]
    top = [j for j in hs if grid.y[j] < cy]
    bottom = [j for j in hs if grid.y[j] > cy]
    if not (left and right and top and bottom):
        return None
    return max(left), min(right), max(top), min(bottom)


def _room_name_for(size: Label, labels: list[Label]) -> str:
    cx, cy = size.center
    above = [lb for lb in labels if lb.role == "room" and abs(lb.center[0] - cx) < 4 * size.height + 30
             and 0 < cy - lb.center[1] < 3 * size.height]
    return min(above, key=lambda lb: cy - lb.center[1]).room_name if above else "Room"


def _constraints(labels: list[Label], grid: _Grid, walls_px, plot) -> list[_C]:
    out: list[_C] = []
    bx = [grid.x[i] for hz, line, a, b, _ in walls_px for i in ((a, b) if hz else (line,))]
    by = [grid.y[j] for hz, line, a, b, _ in walls_px for j in ((line,) if hz else (a, b))]
    b_left, b_right, b_top, b_bottom = grid.xi(min(bx)), grid.xi(max(bx)), grid.yi(min(by)), grid.yi(max(by))
    overall = None
    for lb in labels:
        cx, cy = lb.center
        if lb.role == "size":
            enc = None if lb.overall else _enclosure(walls_px, grid, cx, cy)
            if not enc:
                # a size not written inside a room describes the whole plot (or the house when
                # there's no plot boundary): keep the biggest such size
                if min(lb.value) >= 15 * MM_PER_FT and (overall is None or min(lb.value) > min(overall.value)):
                    overall = lb
                continue
            l, r, t, b = enc
            pw, ph = grid.x[r] - grid.x[l], grid.y[b] - grid.y[t]
            w, h = lb.value
            # "12' x 14'" is width x depth unless the drawing clearly says otherwise
            if abs(np.log((w / h) / (pw / ph))) > abs(np.log((h / w) / (pw / ph))) + 0.35:
                w, h = h, w
            room = _room_name_for(lb, labels)
            out += [_C("x", l, r, w, f"{room} width ({lb.text})", pw), _C("y", t, b, h, f"{room} depth ({lb.text})", ph)]
        elif lb.role == "length" and grid.plot:
            px0, py0, px1, py1 = grid.plot
            if cy < grid.y[py0] or cy > grid.y[py1]:
                out.append(_C("x", px0, px1, lb.value[0], f"Plot width ({lb.text})", weight=3.0))
            elif cx < grid.x[px0] or cx > grid.x[px1]:
                out.append(_C("y", py0, py1, lb.value[0], f"Plot depth ({lb.text})", weight=3.0))
        elif lb.role == "margin" and lb.value and grid.plot:
            px0, py0, px1, py1 = grid.plot
            if cy < grid.y[b_top]:
                out.append(_C("y", py0, b_top, lb.value[0], f"Rear margin ({fi(lb.value[0])})", weight=2.0))
            elif cy > grid.y[b_bottom]:
                out.append(_C("y", b_bottom, py1, lb.value[0], f"Front margin ({fi(lb.value[0])})", weight=2.0))
            elif cx < grid.x[b_left]:
                out.append(_C("x", px0, b_left, lb.value[0], f"Left margin ({fi(lb.value[0])})", weight=2.0))
            elif cx > grid.x[b_right]:
                out.append(_C("x", b_right, px1, lb.value[0], f"Right margin ({fi(lb.value[0])})", weight=2.0))
    if overall:
        l, t, r, b = grid.plot if grid.plot else (b_left, b_top, b_right, b_bottom)
        w, h = overall.value
        pw, ph = grid.x[r] - grid.x[l], grid.y[b] - grid.y[t]
        if (w > h) != (pw > ph):  # "30' x 55'" names the short side first on a tall drawing too
            w, h = h, w
        what = "Plot" if grid.plot else "House"
        out += [_C("x", l, r, w, f"{what} width ({overall.text})", weight=3.0),
                _C("y", t, b, h, f"{what} depth ({overall.text})", weight=3.0)]
    for c in out:
        stations = grid.x if c.axis == "x" else grid.y
        c.px = stations[c.j] - stations[c.i]
    return [c for c in out if c.j > c.i and c.px > 0]


def _scale(constraints: list[_C], grid: _Grid, warnings: list[str]) -> float:
    ratios = [c.value / c.px for c in constraints]
    if ratios:
        return float(median(ratios))
    warnings.append("No sizes could be read, so the plan is scaled to a 30' wide house. Type the real sizes in the editor.")
    return 30 * MM_PER_FT / max(1.0, grid.x[-1] - grid.x[0])


def _solve(grid: _Grid, constraints: list[_C], scale: float) -> tuple[list[float], list[float]]:
    """Station positions in mm: written sizes are hard-ish (weight 1), drawn gaps are a soft prior."""
    result = []
    for axis, px in (("x", grid.x), ("y", grid.y)):
        n = len(px)
        rows, rhs, weights = [], [], []

        def add(coeffs: dict[int, float], value: float, w: float):
            row = np.zeros(n)
            for k, v in coeffs.items():
                row[k] = v
            rows.append(row * w)
            rhs.append(value * w)

        add({0: 1}, 0.0, 10.0)
        for k in range(n - 1):
            add({k + 1: 1, k: -1}, (px[k + 1] - px[k]) * scale, 0.08)
        for c in constraints:
            if c.axis == axis:
                add({c.j: 1, c.i: -1}, c.value, c.weight)
        sol, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
        # whole inches read better than 11'-7.3"
        result.append([round(v / 25.4) * 25.4 for v in sol])
    return result[0], result[1]


# --- model -------------------------------------------------------------------------------------

def _build_model(name, grid: _Grid, X, Y, walls_px, strokes, labels: list[Label], constraints, warnings):
    # walls grouped per drawn line; gaps of door width become doors in one continuous wall
    lines: dict[tuple[bool, int], list[tuple[int, int, float]]] = {}
    for hz, line, a, b, thick in walls_px:
        lines.setdefault((hz, line), []).append((a, b, thick))
    solid = {k: [r for r in v if r[2] != DOOR] for k, v in lines.items()}

    bx = [i for (hz, line), runs in solid.items() for r in runs for i in ((r[0], r[1]) if hz else (line,))]
    by = [j for (hz, line), runs in solid.items() for r in runs for j in ((line,) if hz else (r[0], r[1]))]
    ext_x, ext_y = (min(bx), max(bx)), (min(by), max(by))

    if grid.plot:
        ox, oy_bottom = X[grid.plot[0]], Y[grid.plot[3]]
    else:
        margin = 3 * MM_PER_FT
        ox, oy_bottom = X[ext_x[0]] - margin, Y[ext_y[1]] + margin
        warnings.append("No plot boundary found; assumed 3' margins around the house. Set the plot size in Plot & Site.")

    def pt(xi: int, yi: int) -> tuple[float, float]:
        return (round(X[xi] - ox, 1), round(oy_bottom - Y[yi], 1))

    walls: list[Wall] = []
    openings: list[Opening] = []
    for (hz, line), runs in sorted(lines.items()):
        coords = X if hz else Y
        exterior = line in (ext_y if hz else ext_x)
        doors = [(a, b) for a, b, k in runs if k == DOOR]
        for a, b in _merge_runs(runs):  # touching pieces (incl. doorways) form one wall
            wid = f"W{len(walls) + 1}"
            pa, pb = (pt(a, line), pt(b, line)) if hz else (pt(line, a), pt(line, b))
            if pa == pb:
                continue
            walls.append(Wall(id=wid, a=pa, b=pb, thickness=EXT if exterior else INT,
                              type="exterior" if exterior else "interior",
                              assembly="ext_brick_230" if exterior else "int_brick_115"))
            for d0, d1 in doors:
                if a <= d0 and d1 <= b:
                    width = coords[d1] - coords[d0]
                    if width < 450:
                        continue
                    kind = "door" if width <= DOOR_GAP[1] else "opening"
                    openings.append(Opening(id=f"D{len(openings) + 1}", wall=wid, kind=kind, offset=coords[d0] - coords[a],
                                            width=width, height=7 * MM_PER_FT, sill=0, side=1))

    plot_w = (X[grid.plot[2]] - X[grid.plot[0]]) if grid.plot else (X[ext_x[1]] - X[ext_x[0]] + 6 * MM_PER_FT)
    plot_h = (Y[grid.plot[3]] - Y[grid.plot[1]]) if grid.plot else (Y[ext_y[1]] - Y[ext_y[0]] + 6 * MM_PER_FT)
    t = EXT / 2
    setbacks = Setbacks(front=max(0, oy_bottom - Y[ext_y[1]] - t), rear=max(0, Y[ext_y[0]] - (oy_bottom - plot_h) - t),
                        left=max(0, X[ext_x[0]] - ox - t), right=max(0, ox + plot_w - X[ext_x[1]] - t))

    road = next((lb.room_name for lb in labels if lb.role == "road" and lb.room_name), None)
    if not road:
        warnings.append("Road side not written on the sketch; assumed the bottom edge faces East. Change it in Plot & Site.")
    road = road or "east"
    gate = None
    if (g := next((lb for lb in labels if lb.role == "gate" and lb.value), None)):
        gx = float(np.interp(g.center[0], grid.x, X)) - ox
        gate = (round(max(0.0, gx - g.value[0] / 2), 1), g.value[0])

    template = sample_project()
    model = BuildingModel(
        name=name, north_deg=SIDE_NORTH[road],
        plot=Plot(polygon=[(0, 0), (plot_w, 0), (plot_w, plot_h), (0, plot_h)], road_sides=[road],
                  road_width=None, gate=gate, setbacks=setbacks),
        floors=[Floor(walls=walls, openings=openings)],
        assemblies=template.assemblies,
    )
    floor = model.floors[0]
    rooms = detect_rooms(floor)

    # name rooms from the labels written inside them
    def to_mm(px: tuple[float, float]) -> tuple[float, float]:
        return float(np.interp(px[0], grid.x, X)) - ox, oy_bottom - float(np.interp(px[1], grid.y, Y))

    named = 0
    stairs_mm = [ShPoint(to_mm(((r[0] + r[2]) / 2, (r[1] + r[3]) / 2))) for r in strokes.stairs]
    used_names: dict[str, int] = {}
    for room in rooms:
        poly = Polygon(room.polygon)
        inside = [lb for lb in labels if lb.role == "room" and poly.contains(ShPoint(to_mm(lb.center)))]
        if inside:  # a written name wins; an open stair often shares its space with the hall
            lb = inside[0]
            room.type, room.name, room.label_raw = lb.room_type, lb.room_name, lb.text
            named += 1
        elif any(poly.contains(p) for p in stairs_mm):
            room.type, room.name = "stair", "Staircase"
            named += 1
    for room in rooms:  # Bedroom, Bedroom → Bedroom 1, Bedroom 2
        used_names[room.name] = used_names.get(room.name, 0) + 1
    counters: dict[str, int] = {}
    reading_order = sorted(rooms, key=lambda r: (-round(Polygon(r.polygon).centroid.y / 1000), Polygon(r.polygon).centroid.x))
    for room in reading_order:
        if used_names[room.name] > 1:
            counters[room.name] = counters.get(room.name, 0) + 1
            room.name = f"{room.name} {counters[room.name]}"
    if strokes.stairs and not any(r.type == "stair" for r in rooms):
        warnings.append("Found a staircase, but it isn't closed off by walls, so it is part of a bigger room. "
                        "Draw the walls around it in the editor and set its use to Staircase.")
    missing = [lb.room_name for lb in labels if lb.role == "room" and not lb.guessed
               and not any(Polygon(r.polygon).contains(ShPoint(to_mm(lb.center))) for r in rooms)]
    if missing:
        warnings.append(f"Could not find closed walls around: {', '.join(missing)}. Draw the missing walls in the editor.")
    return model.model_copy(update={"floors": [floor.model_copy(update={"rooms": rooms})]}), named


def _merge_runs(runs: list[tuple[int, int, float]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for a, b, _ in sorted(runs):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


# --- overlay for the check screen -------------------------------------------------------------

def _overlay(img: np.ndarray, grid: _Grid, walls_px, strokes, labels: list[Label]) -> dict:
    h, w = img.shape[:2]
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 82])
    segs = []
    for hz, line, a, b, _ in walls_px:
        segs.append([grid.x[a], grid.y[line], grid.x[b], grid.y[line]] if hz else [grid.x[line], grid.y[a], grid.x[line], grid.y[b]])
    return {
        "width": w, "height": h,
        "image": "data:image/jpeg;base64," + base64.b64encode(jpg.tobytes()).decode() if ok else None,
        "walls": [[round(v, 1) for v in s] for s in segs],
        "plot": [round(v, 1) for v in strokes.plot] if strokes.plot else None,
        "stairs": [[round(v, 1) for v in r] for r in strokes.stairs],
        "ignored": [[round(v, 1) for v in s.box()] for s in strokes.others],
        "labels": [{"text": lb.text, "role": lb.role, "box": [[round(float(x), 1), round(float(y), 1)] for x, y in lb.poly]}
                   for lb in labels],
    }
