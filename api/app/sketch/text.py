"""Read handwritten labels and sort them into room names, sizes, plot dimensions, margins and notes."""

import re
from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

from ..units import MM_PER_FT, MM_PER_IN


@dataclass
class Label:
    text: str
    poly: np.ndarray  # 4x2 px
    score: float
    role: str = "note"  # room | size | length | margin | road | gate | north | note
    value: tuple[float, ...] = ()  # mm: (length,) or (a, b) for sizes
    room_type: str | None = None
    room_name: str | None = None

    @property
    def center(self) -> tuple[float, float]:
        c = self.poly.mean(axis=0)
        return float(c[0]), float(c[1])

    @property
    def height(self) -> float:
        ys = self.poly[:, 1]
        xs = self.poly[:, 0]
        return float(min(ys.max() - ys.min(), xs.max() - xs.min()))


@lru_cache(maxsize=1)
def _engine():
    from rapidocr import RapidOCR  # loads ONNX models (~1 s), so only once

    return RapidOCR(params={"Global.log_level": "error"})


def _ocr(img: np.ndarray) -> list[Label]:
    res = _engine()(img)
    if res.boxes is None:
        return []
    return [Label(text=t.strip(), poly=np.asarray(b, np.float32), score=float(s))
            for b, t, s in zip(res.boxes, res.txts, res.scores) if t.strip()]


def read_text(img: np.ndarray) -> list[Label]:
    labels = []
    for lb in _ocr(img):
        labels += _split_repeats(_reread_sideways(img, lb))
    return labels


def _reread_sideways(img: np.ndarray, lb: Label) -> Label:
    """Dimensions along a vertical side are written sideways; OCR reads them as noise. Re-read the
    crop rotated both ways and keep a reading that parses as a length."""
    xs, ys = lb.poly[:, 0], lb.poly[:, 1]
    w, h = xs.max() - xs.min(), ys.max() - ys.min()
    if h < 1.4 * w or parse_length(lb.text) is not None:
        return lb
    pad = 6
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    crop = img[y0:int(ys.max()) + pad, x0:int(xs.max()) + pad]
    for rot in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
        for r in _ocr(cv2.copyMakeBorder(cv2.rotate(crop, rot), 12, 12, 12, 12, cv2.BORDER_REPLICATE)):
            if parse_length(r.text) is not None or SIZE.match(r.text):
                return Label(text=r.text, poly=lb.poly, score=r.score)
    return lb


def _split_repeats(lb: Label) -> list[Label]:
    """'Toilet Toilet' read as one box over two rooms becomes two labels side by side."""
    words = lb.text.split()
    if len(words) < 2 or len(set(w.lower() for w in words)) != 1:
        return [lb]
    n = len(words)
    tl, tr, br, bl = lb.poly
    out = []
    for i in range(n):
        a, b = i / n, (i + 1) / n
        poly = np.array([tl + (tr - tl) * a, tl + (tr - tl) * b, bl + (br - bl) * b, bl + (br - bl) * a], np.float32)
        out.append(Label(text=words[i], poly=poly, score=lb.score))
    return out


# --- parsing ---------------------------------------------------------------------------------

_NUM = r"(\d+(?:\.\d+)?)"
_FT = r"\s*(?:'|′|’|ft\.?|feet)?"
_INCH = r"(?:\s*-?\s*(\d+(?:\.\d+)?)\s*(?:\"|″|”|''|in))?"
SIZE = re.compile(rf"^\s*{_NUM}{_FT}{_INCH}\s*[x×X*✕]\s*{_NUM}{_FT}{_INCH}\s*$")
LENGTH = re.compile(rf"^\s*{_NUM}\s*(?:'|′|’|ft\.?|feet|m|mtr)\s*{_INCH}\s*$", re.I)
METRIC_HINT = re.compile(r"\d\s*m(tr)?\b", re.I)

ROOM_WORDS: list[tuple[str, str, str]] = [  # (pattern, type, display name)
    (r"master\s*bed(room)?|\bm\.?b\.?r\b", "bedroom", "Master Bedroom"),
    (r"bed\s*room|\bbed\b|\bb\.?r\b|शयन", "bedroom", "Bedroom"),
    (r"toilet|\bw\.?c\b|bath|शौचालय|स्नान", "toilet", "Toilet"),
    (r"kitchen|\bkit\b|रसोई", "kitchen", "Kitchen"),
    (r"living|hall|drawing|lounge|बैठक", "living", "Living"),
    (r"dining", "dining", "Dining"),
    (r"parking|garage|\bcar\b", "parking", "Parking"),
    (r"puja|pooja|prayer|mandir|पूजा", "puja", "Puja"),
    (r"stair|steps|सीढ़ी", "stair", "Staircase"),
    (r"balcony|sit\s*out|verandah?", "balcony", "Balcony"),
    (r"store|storage", "store", "Store"),
    (r"utility|wash", "utility", "Utility"),
    (r"foyer|lobby|entrance|passage", "foyer", "Foyer"),
]
SIDES = {"east": "east", "west": "west", "north": "north", "south": "south"}


def _ft(feet: str, inches: str | None) -> float:
    return float(feet) * MM_PER_FT + float(inches or 0) * MM_PER_IN


def parse_length(text: str) -> float | None:
    t = text.replace(" ", " ").strip()
    if m := LENGTH.match(t):
        if re.search(r"\d\s*m(tr)?\b", t, re.I) and "'" not in t:
            return float(m.group(1)) * 1000
        return _ft(m.group(1), m.group(2))
    return None


def classify(labels: list[Label]) -> list[Label]:
    for lb in labels:
        t = lb.text
        low = t.lower()
        if m := SIZE.match(t):
            metric = METRIC_HINT.search(t) and "'" not in t
            conv = (lambda v, _i: float(v) * 1000) if metric else _ft
            lb.role, lb.value = "size", (conv(m.group(1), m.group(2)), conv(m.group(3), m.group(4)))
            continue
        if "road" in low:
            side = next((v for k, v in SIDES.items() if k in low), None)
            lb.role, lb.room_name = "road", side
            continue
        if "gate" in low:
            lb.role = "gate"
            if (n := re.search(rf"{_NUM}\s*(?:'|ft)", low)):
                lb.value = (float(n.group(1)) * MM_PER_FT,)
            continue
        if "margin" in low or "setback" in low:
            lb.role = "margin"
            if (n := re.search(rf"{_NUM}\s*(?:'|ft)", low)):
                lb.value = (float(n.group(1)) * MM_PER_FT,)
            continue
        if low in ("n", "north") or low.startswith("n ") and len(low) <= 3:
            lb.role = "north"
            continue
        if (v := parse_length(t)) is not None:
            lb.role, lb.value = "length", (v,)
            continue
        for pattern, rtype, name in ROOM_WORDS:
            if re.search(pattern, low):
                lb.role, lb.room_type = "room", rtype
                lb.room_name = _title(t) if len(t) <= 24 else name
                if rtype == "living" and "dining" in low:
                    lb.room_name = "Living / Dining"
                break
    _attach_numbers(labels, "margin", above=True)
    _attach_numbers(labels, "gate", above=False)
    return labels


def _title(t: str) -> str:
    return " ".join(w if w.isupper() and len(w) <= 3 else w.capitalize() for w in t.split())


def _attach_numbers(labels: list[Label], role: str, above: bool) -> None:
    """'5 ft' written just above a separate 'Margin' word (or '12 ft' under 'Main Gate') belongs to it."""
    for m in (lb for lb in labels if lb.role == role and not lb.value):
        mx, my = m.center
        sign = 1 if above else -1
        near = [lb for lb in labels if lb.role == "length" and abs(lb.center[0] - mx) < 3 * m.height + 40
                and 0 < sign * (my - lb.center[1]) < 2.5 * m.height]
        if near:
            n = min(near, key=lambda lb: abs(my - lb.center[1]))
            m.value = n.value
            n.role = "used"
