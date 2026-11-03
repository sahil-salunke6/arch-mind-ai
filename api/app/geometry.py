"""Plan geometry shared by the exporters."""

from math import hypot

from .model import Opening, Wall


def wall_frame(wall: Wall) -> tuple[tuple[float, float], tuple[float, float]]:
    """Unit direction along the wall and its left normal."""
    dx, dy = wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]
    n = hypot(dx, dy)
    return (dx / n, dy / n), (-dy / n, dx / n)


def solid_spans(wall: Wall, openings: list[Opening]) -> list[tuple[float, float]]:
    """Distances along the wall that are solid in plan (not cut by an opening).

    Each wall is extended by half its thickness at both ends so corners close.
    """
    ext = wall.thickness / 2
    cuts = sorted((o.offset, o.offset + o.width) for o in openings if o.wall == wall.id)
    spans, cursor = [], -ext
    for s0, s1 in cuts:
        if s0 > cursor:
            spans.append((cursor, s0))
        cursor = max(cursor, s1)
    if wall.length + ext > cursor:
        spans.append((cursor, wall.length + ext))
    return spans


def span_rect(wall: Wall, s0: float, s1: float) -> list[tuple[float, float]]:
    (ux, uy), (nx, ny) = wall_frame(wall)
    h = wall.thickness / 2
    ax, ay = wall.a
    return [
        (ax + ux * s + nx * k, ay + uy * s + ny * k)
        for s, k in ((s0, -h), (s1, -h), (s1, h), (s0, h))
    ]


def point_on_wall(wall: Wall, s: float, k: float = 0) -> tuple[float, float]:
    (ux, uy), (nx, ny) = wall_frame(wall)
    return (wall.a[0] + ux * s + nx * k, wall.a[1] + uy * s + ny * k)


def outward_normal(wall: Wall, center: tuple[float, float]) -> tuple[float, float]:
    """Normal of an exterior wall pointing away from the building centre."""
    _, (nx, ny) = wall_frame(wall)
    mx, my = (wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2
    return (nx, ny) if nx * (mx - center[0]) + ny * (my - center[1]) > 0 else (-nx, -ny)


def bbox(points) -> tuple[float, float, float, float]:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def footprint(floor) -> tuple[float, float, float, float]:
    """Outer bounding box of the exterior walls (all walls while there are none; 0-size when empty)."""
    if not floor.walls:
        return 0.0, 0.0, 0.0, 0.0
    ext = [w for w in floor.walls if w.type == "exterior"] or floor.walls
    x0, y0, x1, y1 = bbox([p for w in ext for p in (w.a, w.b)])
    ax0, ay0, ax1, ay1 = bbox([p for w in floor.walls for p in (w.a, w.b)])
    if (x1 - x0) * (y1 - y0) < 0.5 * (ax1 - ax0) * (ay1 - ay0):  # outer walls only partly found
        ext, (x0, y0, x1, y1) = floor.walls, (ax0, ay0, ax1, ay1)
    t = max(w.thickness for w in ext) / 2
    return x0 - t, y0 - t, x1 + t, y1 + t


def stair_layout(room, rise: float) -> list[tuple[tuple[float, float, float, float], float, int]]:
    """Dog-leg stair as (rect, top, flight); flight -1 is the landing. Mirrors web/src/lib/geometry.ts."""
    x0, y0, x1, y1 = bbox(room.polygon)
    along_x = (x1 - x0) >= (y1 - y0)
    long, short = (x1 - x0, y1 - y0) if along_x else (y1 - y0, x1 - x0)
    landing = short / 2
    run = long - landing
    n = max(5, round(run / 250))
    tread = run / n
    r = rise / (2 * n + 1)

    def rect(l0, l1, s0, s1):
        return (x0 + l0, y0 + s0, x0 + l1, y0 + s1) if along_x else (x0 + s0, y0 + l0, x0 + s1, y0 + l1)

    out = [(rect(i * tread, (i + 1) * tread, 0, short / 2), (i + 1) * r, 0) for i in range(n)]
    out.append((rect(run, long, 0, short), (n + 1) * r, -1))
    out += [(rect(run - (i + 1) * tread, run - i * tread, short / 2, short), (n + 2 + i) * r, 1) for i in range(n)]
    return out
