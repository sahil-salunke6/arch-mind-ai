"""Find straight pen strokes and decide which ones are walls, the plot boundary, or stair treads.

Works in pixels on the ink mask. Plans are assumed orthogonal (walls horizontal/vertical on the page).
"""

from dataclasses import dataclass, field
from statistics import median

import cv2
import numpy as np


@dataclass
class Seg:
    horizontal: bool
    pos: float  # y of a horizontal stroke, x of a vertical one
    a: float  # start along the stroke
    b: float  # end
    thick: float = 0.0  # distance between the two pen lines of a double-line wall; 0 = single line
    partners: list[float] = field(default_factory=list)
    pen: float = 0.0  # measured pen width in px (walls are usually drawn heavier than furniture)

    @property
    def length(self) -> float:
        return self.b - self.a

    def box(self) -> tuple[float, float, float, float]:
        return (self.a, self.pos, self.b, self.pos) if self.horizontal else (self.pos, self.a, self.pos, self.b)


Rect = tuple[float, float, float, float]  # x0, y0, x1, y1 in px


@dataclass
class Strokes:
    walls: list[Seg]
    plot: Rect | None
    stairs: list[Rect]
    style: str  # "double" or "single" line walls
    others: list[Seg]  # rejected strokes (dimension arrows, road, notes), for the debug overlay


def find_strokes(mask: np.ndarray, text_polys: list[np.ndarray] = ()) -> Strokes:
    L = max(mask.shape)
    m = cv2.dilate(mask, np.ones((3, 3), np.uint8))

    segs = _drop_lettering(_raw_segments(m, L), text_polys, L)
    segs = _drop_page_edges(segs, mask.shape, L)
    segs = _merge_collinear(segs, tol=0.003 * L, gap=0.008 * L)
    stairs, segs = _split_stairs(segs, L)
    segs = _pair_double_lines(segs, lo=0.0035 * L, hi=0.02 * L)

    # The outermost closed rectangle is the plot if a second one (the building) sits clearly inside it;
    # otherwise it is the building itself. Strokes outside it are dimension arrows, the road, notes.
    rects = _closed_rects(segs, L)
    outer = rects[0] if rects else None
    # ...but only if that inner rectangle is house-sized (not a bed or a car), and the outer one is
    # drawn as plain lines: an outline drawn as a double line is the house's own outer wall
    def area(r):
        return (r[2] - r[0]) * (r[3] - r[1])

    plot = None
    if outer and any(_strictly_inside(r, outer, 0.02 * L) and area(r) >= 0.3 * area(outer) for r in rects[1:]):
        edge = [s for s in segs if _on_rect(s, outer, 0.012 * L) and s.length > 0.1 * L]
        if sum(s.length for s in edge if s.thick) < 0.5 * max(1.0, sum(s.length for s in edge)):
            plot = outer
    keep_in = plot or outer
    # an L-shaped or irregular house has no closed outer rectangle; the largest rectangle found is
    # then just one wing, and trimming to it would throw the rest of the house away
    if keep_in and not plot:
        inside = sum(s.length for s in segs if _within(s, keep_in, 0.012 * L))
        if inside < 0.8 * sum(s.length for s in segs):
            keep_in = None
    if keep_in:
        walls = [s for s in segs if _within(s, keep_in, 0.012 * L) and not (plot and _on_rect(s, plot, 0.012 * L))]
    else:
        walls = list(segs)
    _measure_pen(walls, mask, L)
    walls = _drop_furniture(walls, L)
    others = [s for s in segs if s not in walls]
    style = "double" if sum(1 for s in walls if s.thick) >= 0.5 * max(1, len(walls)) else "single"
    return Strokes(walls=walls, plot=plot, stairs=stairs, style=style, others=others)


def _raw_segments(m: np.ndarray, L: int) -> list[Seg]:
    k = max(15, int(0.025 * L))
    out = []
    for horizontal in (True, False):
        kernel = np.ones((1, k) if horizontal else (k, 1), np.uint8)
        lines = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel)
        n, labels, stats, cents = cv2.connectedComponentsWithStats(lines)
        for i in range(1, n):
            x, y, w, h, _ = stats[i]
            if horizontal and w >= k:
                seg = Seg(True, float(cents[i][1]), float(x), float(x + w))
                comp = labels[y:y + h, x:x + w] == i
            elif not horizontal and h >= k:
                seg = Seg(False, float(cents[i][0]), float(y), float(y + h))
                comp = (labels[y:y + h, x:x + w] == i).T
            else:
                continue
            seg.thick = _double_spacing(comp)
            out.append(seg)
    return out


def _drop_lettering(segs: list[Seg], text_polys, L: int) -> list[Seg]:
    """Joined-up handwriting makes short straight runs; drop those lying mostly inside a text box.
    (Masking the text instead would also erase wall lines the labels touch.)"""
    if not len(text_polys):
        return segs
    boxes = [(p[:, 0].min() - 3, p[:, 1].min() - 3, p[:, 0].max() + 3, p[:, 1].max() + 3) for p in text_polys]

    def inside_fraction(s: Seg) -> float:
        best = 0.0
        for x0, y0, x1, y1 in boxes:
            if s.horizontal and y0 <= s.pos <= y1:
                best = max(best, (min(s.b, x1) - max(s.a, x0)) / s.length)
            elif not s.horizontal and x0 <= s.pos <= x1:
                best = max(best, (min(s.b, y1) - max(s.a, y0)) / s.length)
        return best

    def underlines(s: Seg) -> bool:
        """A line drawn just under a title ("HOUSE PLAN - 18m x 25m")."""
        if not s.horizontal:
            return False
        for x0, y0, x1, y1 in boxes:
            h = y1 - y0
            if y1 - 0.3 * h <= s.pos <= y1 + 0.8 * h and s.length <= 1.3 * (x1 - x0) and (min(s.b, x1) - max(s.a, x0)) >= 0.7 * s.length:
                return True
        return False

    return [s for s in segs if (s.length > 0.12 * L or inside_fraction(s) < 0.6) and not underlines(s)]


def _drop_page_edges(segs: list[Seg], shape, L: int) -> list[Seg]:
    """The paper edge or the table behind it shows up as lines hugging the image border."""
    H, W = shape[:2]
    m = 0.012 * L
    return [s for s in segs if not ((s.pos < m or s.pos > (H if s.horizontal else W) - m))]


def _measure_pen(segs: list[Seg], mask: np.ndarray, L: int) -> None:
    """Median count of ink pixels across the stroke, sampled along it (per pen line for double walls)."""
    H, W = mask.shape
    for s in segs:
        half = int(s.thick / 2 + max(4, 0.006 * L))
        samples = []
        for t in np.linspace(s.a + 0.1 * s.length, s.b - 0.1 * s.length, 15):
            if s.horizontal:
                x, y = int(t), int(s.pos)
                col = mask[max(0, y - half):min(H, y + half + 1), min(W - 1, max(0, x))]
            else:
                x, y = int(s.pos), int(t)
                col = mask[min(H - 1, max(0, y)), max(0, x - half):min(W, x + half + 1)]
            samples.append(int((col > 0).sum()))
        s.pen = float(np.median(samples)) / (2 if s.thick else 1)


def _drop_furniture(walls: list[Seg], L: int) -> list[Seg]:
    """Beds, sofas, tables and cars are drawn with straight lines too. Two clues tell them apart:
    walls are often drawn with a heavier pen, and walls join up into one network while furniture
    floats inside rooms."""
    singles = [s for s in walls if not s.thick]
    if len(singles) >= 6:
        split = _heavy_pen_split(singles)
        if split is not None:
            walls = [s for s in walls if s.thick or s.pen >= split]
    # keep only strokes connected to the main wall network
    n = len(walls)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    tol = 0.012 * L
    for i in range(n):
        for j in range(i + 1, n):
            if _touch(walls[i], walls[j], tol):
                parent[find(i)] = find(j)
    size: dict[int, float] = {}
    for i, s in enumerate(walls):
        size[find(i)] = size.get(find(i), 0.0) + s.length
    if not size:
        return walls
    biggest = max(size.values())
    return [s for i, s in enumerate(walls) if size[find(i)] >= 0.12 * biggest]


def _heavy_pen_split(segs: list[Seg]) -> float | None:
    """Otsu threshold on pen width (weighted by length), if the drawing clearly uses two pens."""
    pens = np.array([s.pen for s in segs])
    weights = np.array([s.length for s in segs])
    best, best_score = None, 0.0
    for t in np.unique(pens)[1:]:
        lo, hi = pens < t, pens >= t
        wl, wh = weights[lo].sum(), weights[hi].sum()
        if wl == 0 or wh == 0:
            continue
        ml, mh = np.average(pens[lo], weights=weights[lo]), np.average(pens[hi], weights=weights[hi])
        score = wl * wh * (mh - ml) ** 2
        if score > best_score:
            best, best_score, means, share = t, score, (ml, mh), wh / weights.sum()
    if best is None or means[1] < 1.6 * max(means[0], 1.0) or share < 0.25:
        return None
    return float(best)


def _touch(p: Seg, q: Seg, tol: float) -> bool:
    if p.horizontal == q.horizontal:
        return abs(p.pos - q.pos) <= tol and p.a - tol <= q.b and q.a - tol <= p.b
    h, v = (p, q) if p.horizontal else (q, p)
    return h.a - tol <= v.pos <= h.b + tol and v.a - tol <= h.pos <= v.b + tol


def _double_spacing(comp: np.ndarray) -> float:
    """Two pen lines joined by cross ticks form one blob; its row profile then has two peaks."""
    rows = comp.sum(axis=1) / comp.shape[1]
    strong = np.flatnonzero(rows > 0.45)
    if len(strong) < 2:
        return 0.0
    groups = np.split(strong, np.flatnonzero(np.diff(strong) > 1) + 1)
    if len(groups) < 2:
        return 0.0
    return float(groups[-1].mean() - groups[0].mean())


def _merge_collinear(segs: list[Seg], tol: float, gap: float) -> list[Seg]:
    """Join pieces of one wobbly pen line."""
    out = []
    for hz in (True, False):
        group = sorted((s for s in segs if s.horizontal == hz), key=lambda s: (s.a, s.pos))
        merged: list[Seg] = []
        for s in group:
            for t in merged:
                if abs(t.pos - s.pos) <= tol and s.a <= t.b + gap and t.a <= s.b + gap:
                    w0, w1 = t.length, s.length
                    t.pos = (t.pos * w0 + s.pos * w1) / (w0 + w1)
                    t.a, t.b = min(t.a, s.a), max(t.b, s.b)
                    t.thick = max(t.thick, s.thick)
                    break
            else:
                merged.append(Seg(hz, s.pos, s.a, s.b, s.thick))
        out += merged
    return out


def _pair_double_lines(segs: list[Seg], lo: float, hi: float) -> list[Seg]:
    """A wall drawn as two parallel lines becomes one stroke on its centre line.

    The inner line of an outer wall is broken at every partition, so a long line may absorb several
    shorter partners on the same side.
    """
    order = sorted(range(len(segs)), key=lambda i: segs[i].length)

    def candidates(i: int):
        t = segs[i]
        for j in order:
            s = segs[j]
            if j == i or s.horizontal != t.horizontal or s.length < t.length * 0.9:
                continue
            d = abs(s.pos - t.pos)
            if lo <= d <= hi and min(s.b, t.b) - max(s.a, t.a) >= 0.6 * t.length:
                yield j, d

    # walls in one drawing share a pen spacing; reject pairs far from the typical one
    # (e.g. a dimension arrow drawn next to the plot line)
    spacings = [d for i in order for _, d in candidates(i)] + [s.thick for s in segs if s.thick]
    if spacings:
        hi = min(hi, 1.6 * median(spacings))

    absorbed: set[int] = set()
    for i in order:
        t = segs[i]
        if t.partners:
            continue
        best = min(((j, d) for j, d in candidates(i) if j not in absorbed and d <= hi), key=lambda jd: jd[1], default=None)
        if best is not None:
            s = segs[best[0]]
            s.partners.append(t.pos - s.pos)
            s.a, s.b = min(s.a, t.a), max(s.b, t.b)
            absorbed.add(i)
    out = []
    for i, s in enumerate(segs):
        if i in absorbed:
            continue
        if s.partners:
            off = median(s.partners)
            s.pos += off / 2
            s.thick = abs(off)
        elif s.thick > hi:
            s.thick = 0.0
        out.append(s)
    return out


def _split_stairs(segs: list[Seg], L: int) -> tuple[list[Rect], list[Seg]]:
    """Four or more short, evenly spaced, parallel lines are stair treads."""
    stairs, used = [], set()
    short = [s for s in segs if s.length < 0.15 * L]
    for hz in (True, False):
        group = sorted((s for s in short if s.horizontal == hz), key=lambda s: s.pos)
        i = 0
        while i < len(group):
            run = [group[i]]
            for s in group[i + 1:]:
                last = run[-1]
                spacing = s.pos - last.pos
                if spacing > 0.045 * L:
                    break
                overlap = min(s.b, last.b) - max(s.a, last.a)
                if spacing >= 0.006 * L and overlap >= 0.6 * min(s.length, last.length) and 0.7 < s.length / last.length < 1.4:
                    run.append(s)
            if len(run) >= 4:
                stairs.append(_bbox(run))
                used.update(id(s) for s in run)
                i += len(run)
            else:
                i += 1
    # anything else drawn inside a stair (handrail, landing line) belongs to it
    for rect in stairs:
        used.update(id(s) for s in short if _within(s, rect, 0.01 * L))
    return stairs, [s for s in segs if id(s) not in used]


def _bbox(segs: list[Seg]) -> Rect:
    xs = [v for s in segs for v in (s.box()[0], s.box()[2])]
    ys = [v for s in segs for v in (s.box()[1], s.box()[3])]
    return min(xs), min(ys), max(xs), max(ys)


@dataclass
class _Line:
    """All strokes along one drawn line (a hand-drawn side is often broken or drifts slightly)."""
    horizontal: bool
    pos: float
    spans: list[tuple[float, float]]

    def covered(self, lo: float, hi: float) -> float:
        return sum(max(0.0, min(b, hi) - max(a, lo)) for a, b in self.spans)

    def reaches(self, v: float, tol: float) -> bool:
        return any(a - tol <= v <= b + tol for a, b in self.spans)


def _lines(segs: list[Seg], tol: float, min_len: float) -> list[_Line]:
    out: list[_Line] = []
    for s in sorted(segs, key=lambda s: -s.length):
        if s.length < min_len:
            continue
        for ln in out:
            if ln.horizontal == s.horizontal and abs(ln.pos - s.pos) <= tol:
                ln.spans.append((s.a, s.b))
                break
        else:
            out.append(_Line(s.horizontal, s.pos, [(s.a, s.b)]))
    return out


def _closed_rects(segs: list[Seg], L: int) -> list[Rect]:
    """Rectangles whose four sides are drawn (each mostly covered, three corners closed), largest first."""
    tol = 0.015 * L  # tight: dimension arrows run parallel to the plot sides just outside them
    lines = _lines(segs, 0.012 * L, 0.05 * L)
    hs = [ln for ln in lines if ln.horizontal and ln.covered(-1e9, 1e9) >= 0.15 * L]
    vs = [ln for ln in lines if not ln.horizontal and ln.covered(-1e9, 1e9) >= 0.15 * L]
    found = []
    for top in hs:
        for bottom in hs:
            if bottom.pos - top.pos < 0.15 * L:
                continue
            for left in vs:
                for right in vs:
                    if right.pos - left.pos < 0.1 * L:
                        continue
                    x0, y0, x1, y1 = left.pos, top.pos, right.pos, bottom.pos
                    w, h = x1 - x0, y1 - y0
                    if (min(top.covered(x0, x1), bottom.covered(x0, x1)) < 0.6 * w
                            or min(left.covered(y0, y1), right.covered(y0, y1)) < 0.6 * h):
                        continue
                    corners = [top.reaches(x0, tol) and left.reaches(y0, tol), top.reaches(x1, tol) and right.reaches(y0, tol),
                               bottom.reaches(x0, tol) and left.reaches(y1, tol), bottom.reaches(x1, tol) and right.reaches(y1, tol)]
                    if sum(corners) >= 3:
                        found.append((x0, y0, x1, y1))
    found.sort(key=lambda r: -(r[2] - r[0]) * (r[3] - r[1]))
    return found


def _strictly_inside(inner: Rect, outer: Rect, margin: float) -> bool:
    return (inner[0] - outer[0] > margin and outer[2] - inner[2] > margin
            and inner[1] - outer[1] > margin and outer[3] - inner[3] > margin)


def _on_rect(s: Seg, rect: Rect, tol: float) -> bool:
    """Runs along one of the rectangle's sides (any length: hand-drawn sides break into pieces)."""
    x0, y0, x1, y1 = rect
    if s.horizontal:
        return abs(s.pos - y0) < tol or abs(s.pos - y1) < tol
    return abs(s.pos - x0) < tol or abs(s.pos - x1) < tol


def _within(s: Seg, rect: Rect, pad: float) -> bool:
    x0, y0, x1, y1 = rect
    bx = s.box()
    return x0 - pad <= min(bx[0], bx[2]) and max(bx[0], bx[2]) <= x1 + pad and y0 - pad <= min(bx[1], bx[3]) and max(bx[1], bx[3]) <= y1 + pad
