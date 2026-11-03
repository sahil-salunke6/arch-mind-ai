"""Synthetic hand-drawn sketches of a BuildingModel, for testing the sketch reader.

The drawing is deliberately *not* to scale (stretched sideways, wobbly lines), so a reader that trusts
proportions instead of the written sizes fails the tests.
"""

import cv2
import numpy as np

from app.geometry import solid_spans, wall_frame
from app.model import BuildingModel

INK = (150, 60, 30)  # blue-ish ballpoint (BGR)


def draw_sketch(model: BuildingModel, px_per_ft: float = 15.0, stretch_x: float = 1.18, seed: int = 3,
                photo: bool = False) -> bytes:
    rng = np.random.default_rng(seed)
    floor = model.floors[0]
    xs = [p[0] for p in model.plot.polygon]
    ys = [p[1] for p in model.plot.polygon]
    w_ft, h_ft = max(xs) / 304.8, max(ys) / 304.8
    margin = 110
    W = int(w_ft * px_per_ft * stretch_x + 2 * margin)
    H = int(h_ft * px_per_ft + 2 * margin + 60)
    img = np.full((H, W, 3), (238, 240, 242), np.uint8)

    def P(x_mm: float, y_mm: float) -> tuple[float, float]:
        return (margin + x_mm / 304.8 * px_per_ft * stretch_x, margin + (max(ys) - y_mm) / 304.8 * px_per_ft)

    def pen(a, b, thick=2):
        (x0, y0), (x1, y1) = a, b
        n = max(2, int(np.hypot(x1 - x0, y1 - y0) / 25))
        pts = np.linspace((x0, y0), (x1, y1), n)
        pts[1:-1] += rng.normal(0, 0.9, (n - 2, 2))
        cv2.polylines(img, [pts.astype(np.int32)], False, INK, thick, cv2.LINE_AA)

    def text(s: str, center, scale=0.55):
        (tw, th), _ = cv2.getTextSize(s, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)
        cv2.putText(img, s, (int(center[0] - tw / 2), int(center[1] + th / 2)), cv2.FONT_HERSHEY_SIMPLEX, scale, INK, 2, cv2.LINE_AA)

    # plot boundary + labels around it
    corners = [P(*p) for p in model.plot.polygon]
    for i in range(4):
        pen(corners[i], corners[(i + 1) % 4])
    text(f"{round(w_ft)} ft", (W / 2, margin - 40), 0.7)
    road = model.plot.road_sides[0].title()
    text(f"Road ({road})", (W / 2, H - 45), 0.7)

    # walls, broken at openings (doors are left as gaps, as people sketch them)
    for wall in floor.walls:
        for s0, s1 in solid_spans(wall, floor.openings):
            s0, s1 = max(s0, 0), min(s1, wall.length)
            (ux, uy), _ = wall_frame(wall)
            a = (wall.a[0] + ux * s0, wall.a[1] + uy * s0)
            b = (wall.a[0] + ux * s1, wall.a[1] + uy * s1)
            pen(P(*a), P(*b), 3 if wall.type == "exterior" else 2)

    for room in floor.rooms:
        rx = [p[0] for p in room.polygon]
        ry = [p[1] for p in room.polygon]
        cx, cy = P((min(rx) + max(rx)) / 2, (min(ry) + max(ry)) / 2)
        small = (max(rx) - min(rx)) < 7 * 304.8
        name = room.name.split(" / ")[0].replace("Master Bedroom", "Bedroom").split(" ")[0]
        if room.type in ("stair", "foyer"):
            continue
        text(name, (cx, cy - 12), 0.42 if small else 0.55)
        size = f"{round((max(rx) - min(rx)) / 304.8)}'x{round((max(ry) - min(ry)) / 304.8)}'"
        text(size, (cx, cy + 14), 0.42 if small else 0.55)

    sb = model.plot.setbacks
    text(f"{round(sb.front / 304.8)} ft Margin", (P(max(xs) * 0.5, sb.front / 2)[0] + 120, P(0, sb.front / 2)[1]), 0.5)

    if photo:
        img = _as_phone_photo(img, rng)
    ok, buf = cv2.imencode(".jpg" if photo else ".png", img)
    assert ok
    return buf.tobytes()


def _as_phone_photo(page: np.ndarray, rng) -> np.ndarray:
    """Page lying on a darker table, shot at an angle, with a soft shadow across it."""
    h, w = page.shape[:2]
    H, W = int(h * 1.35), int(w * 1.45)
    table = np.full((H, W, 3), (70, 85, 100), np.uint8)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[W * 0.12, H * 0.10], [W * 0.86, H * 0.07], [W * 0.92, H * 0.93], [W * 0.08, H * 0.88]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(page, M, (W, H))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (W, H))
    out = np.where(mask[..., None] > 0, warped, table)
    shade = np.linspace(0.72, 1.0, W)[None, :, None] * np.linspace(1.0, 0.85, H)[:, None, None]
    return np.clip(out * shade + rng.normal(0, 3, out.shape), 0, 255).astype(np.uint8)
