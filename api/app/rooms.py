"""Derive rooms from the wall layout, keeping names of rooms the user already labelled."""

import uuid

from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, unary_union

from .model import Floor, Room

MIN_ROOM_AREA = 0.6e6  # mm²: anything smaller (≈ 6.5 sq ft) is a drawing artefact


def detect_rooms(floor: Floor) -> list[Room]:
    """Closed wall loops become rooms; each takes over the existing room it overlaps most."""
    if not floor.walls:
        return []
    lines = unary_union([LineString([w.a, w.b]) for w in floor.walls])
    faces = sorted(
        (orient(p.simplify(1.0)) for p in polygonize(lines) if p.area >= MIN_ROOM_AREA),
        key=lambda p: -p.area,
    )
    previous = [(r, Polygon(r.polygon)) for r in floor.rooms if len(r.polygon) >= 3]
    used: set[str] = set()
    rooms: list[Room] = []
    taken = {r.name for r in floor.rooms}
    unnamed = 0
    for face in faces:
        best, best_overlap = None, 0.0
        for room, poly in previous:
            if room.id in used or not poly.is_valid:
                continue
            overlap = poly.intersection(face).area
            if overlap > best_overlap:
                best, best_overlap = room, overlap
        polygon = [(round(x, 1), round(y, 1)) for x, y in list(face.exterior.coords)[:-1]]
        if best and best_overlap > 0.5 * face.area:
            used.add(best.id)
            rooms.append(best.model_copy(update={"polygon": polygon}))
        else:
            unnamed += 1
            while f"Room {unnamed}" in taken:
                unnamed += 1
            taken.add(f"Room {unnamed}")
            rooms.append(Room(id=f"R-{uuid.uuid4().hex[:8]}", name=f"Room {unnamed}", type="other",
                              polygon=polygon))
    return _unique_names(rooms)


def _unique_names(rooms: list[Room]) -> list[Room]:
    """Two rooms never share a name: later duplicates get a numeric suffix."""
    seen: set[str] = set()
    out = []
    for room in rooms:
        name, n = room.name, 1
        while name in seen:
            n += 1
            name = f"{room.name} ({n})"
        seen.add(name)
        out.append(room if name == room.name else room.model_copy(update={"name": name}))
    return out
