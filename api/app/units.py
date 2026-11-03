"""Parse and format lengths the way they're written on Indian drawings."""

import re

MM_PER_FT = 304.8
MM_PER_IN = 25.4

_FT_IN = re.compile(
    r"""^\s*(?P<ft>\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-?\s*
        (?:(?P<inch>\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches)?)?\s*$""",
    re.X | re.I,
)
_INCH = re.compile(r'^\s*(?P<inch>\d+(?:\.\d+)?)\s*(?:"|\'\'|in|inch|inches)\s*$', re.I)
_METRIC = re.compile(r"^\s*(?P<v>\d+(?:\.\d+)?)\s*(?P<u>mm|cm|m)\s*$", re.I)
_NUMBER = re.compile(r"^\s*(?P<v>\d+(?:\.\d+)?)\s*$")
_PAIR = re.compile(r"^\s*(?P<a>[^x×*]+?)\s*[x×*]\s*(?P<b>[^x×*]+?)\s*$", re.I)


def ft(value: float) -> float:
    return value * MM_PER_FT


def parse_length(text: str, default_unit: str = "ft") -> float:
    """Return millimetres for strings like 12'6", 12'-6", 12.5', 9", 3.81m, 3810mm, 40."""
    if m := _FT_IN.match(text):
        return float(m["ft"]) * MM_PER_FT + float(m["inch"] or 0) * MM_PER_IN
    if m := _INCH.match(text):
        return float(m["inch"]) * MM_PER_IN
    if m := _METRIC.match(text):
        return float(m["v"]) * {"mm": 1, "cm": 10, "m": 1000}[m["u"].lower()]
    if m := _NUMBER.match(text):
        v = float(m["v"])
        return {"ft": v * MM_PER_FT, "m": v * 1000, "mm": v}[default_unit]
    raise ValueError(f"not a length: {text!r}")


def parse_size(text: str, default_unit: str = "ft") -> tuple[float, float]:
    """Parse '30x40', "30'x40'", '12 x 14' into (width_mm, depth_mm)."""
    m = _PAIR.match(text)
    if not m:
        raise ValueError(f"not a size: {text!r}")
    return parse_length(m["a"], default_unit), parse_length(m["b"], default_unit)


def format_ft_in(mm: float) -> str:
    """3810 -> 12'-6". Rounded to the nearest half inch."""
    inches = round(mm / MM_PER_IN * 2) / 2
    feet, rest = divmod(inches, 12)
    rest_str = f"{rest:g}"
    return f"{int(feet)}'" if rest == 0 else f"{int(feet)}'-{rest_str}\""


SQFT_PER_SQMM = 1 / (MM_PER_FT**2)


def sqft(area_mm2: float) -> float:
    return area_mm2 * SQFT_PER_SQMM
