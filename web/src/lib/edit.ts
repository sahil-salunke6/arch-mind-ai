// Pure edit operations on a BuildingModel. Every function returns a new model.

import type { BuildingModel, Floor, Opening, Point, Room, Side, Wall } from "../types";
import { MM_PER_FT, wallFrame, wallLength } from "./geometry";

export const EXT_THICKNESS = 0.75 * MM_PER_FT; // 9"
export const INT_THICKNESS = 115; // 4.5"
const SAME = 1; // mm: endpoints closer than this are joined

const same = (p: Point, q: Point) => Math.abs(p[0] - q[0]) < SAME && Math.abs(p[1] - q[1]) < SAME;

function withFloor(model: BuildingModel, fn: (f: Floor) => Floor): BuildingModel {
  return { ...model, floors: [fn(model.floors[0]), ...model.floors.slice(1)] };
}

/** Keep openings inside their walls; drop the ones that no longer fit. */
function clampOpenings(floor: Floor): Floor {
  const walls = new Map(floor.walls.map((w) => [w.id, w]));
  const openings = floor.openings.flatMap((o) => {
    const w = walls.get(o.wall);
    if (!w) return [];
    const len = wallLength(w);
    if (o.width > len) return [];
    return [{ ...o, offset: Math.min(Math.max(0, o.offset), len - o.width) }];
  });
  return { ...floor, openings };
}

function nextId(prefix: string, ids: string[]) {
  let n = ids.length + 1;
  while (ids.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Move every wall end sitting at `from` (joined walls follow) to `to`. */
function moveJoint(walls: Wall[], from: Point, to: Point): Wall[] {
  return walls.map((w) => ({ ...w, a: same(w.a, from) ? to : w.a, b: same(w.b, from) ? to : w.b }));
}

export function moveEndpoint(model: BuildingModel, wallId: string, end: "a" | "b", to: Point, original: BuildingModel) {
  const from = original.floors[0].walls.find((w) => w.id === wallId)![end];
  return withFloor(model, (f) => clampOpenings({ ...f, walls: moveJoint(original.floors[0].walls, from, to) }));
}

/** Slide a wall sideways (along its normal); walls joined at its ends stretch to follow. */
export function moveWall(model: BuildingModel, wallId: string, delta: Point, original: BuildingModel) {
  const w0 = original.floors[0].walls.find((w) => w.id === wallId)!;
  const { n } = wallFrame(w0);
  const k = delta[0] * n[0] + delta[1] * n[1];
  const shift = (p: Point): Point => [p[0] + n[0] * k, p[1] + n[1] * k];
  let walls = moveJoint(original.floors[0].walls, w0.a, shift(w0.a));
  walls = moveJoint(walls, w0.b, shift(w0.b));
  return withFloor(model, (f) => clampOpenings({ ...f, walls }));
}

export function setWallLength(model: BuildingModel, wallId: string, length: number) {
  const w = model.floors[0].walls.find((x) => x.id === wallId)!;
  const { u } = wallFrame(w);
  return withFloor(model, (f) => clampOpenings({ ...f, walls: moveJoint(f.walls, w.b, [w.a[0] + u[0] * length, w.a[1] + u[1] * length]) }));
}

export function updateWall(model: BuildingModel, wallId: string, patch: Partial<Wall>) {
  return withFloor(model, (f) => ({ ...f, walls: f.walls.map((w) => (w.id === wallId ? { ...w, ...patch } : w)) }));
}

export function addWall(model: BuildingModel, a: Point, b: Point, type: Wall["type"] = "interior"): [BuildingModel, string] {
  const id = nextId("W", model.floors[0].walls.map((w) => w.id));
  const wall: Wall = {
    id, a, b, type,
    thickness: type === "exterior" ? EXT_THICKNESS : INT_THICKNESS,
    assembly: type === "exterior" ? (model.assemblies.ext_brick_230 ? "ext_brick_230" : null) : (model.assemblies.int_brick_115 ? "int_brick_115" : null),
  };
  return [withFloor(model, (f) => ({ ...f, walls: [...f.walls, wall] })), id];
}

export function setWallType(model: BuildingModel, wallId: string, type: Wall["type"]) {
  const [probe] = addWall(model, [0, 0], [1, 0], type);
  const template = probe.floors[0].walls.at(-1)!;
  return updateWall(model, wallId, { type, thickness: template.thickness, assembly: template.assembly });
}

export function deleteWall(model: BuildingModel, wallId: string) {
  return withFloor(model, (f) => ({ ...f, walls: f.walls.filter((w) => w.id !== wallId), openings: f.openings.filter((o) => o.wall !== wallId) }));
}

const OPENING_DEFAULTS: Record<Opening["kind"], { width: number; height: number; sill: number }> = {
  door: { width: 3 * MM_PER_FT, height: 7 * MM_PER_FT, sill: 0 },
  window: { width: 4 * MM_PER_FT, height: 4 * MM_PER_FT, sill: 3 * MM_PER_FT },
  ventilator: { width: 2 * MM_PER_FT, height: 1.5 * MM_PER_FT, sill: 5.5 * MM_PER_FT },
  opening: { width: 4 * MM_PER_FT, height: 7 * MM_PER_FT, sill: 0 },
};

export function addOpening(model: BuildingModel, wallId: string, kind: Opening["kind"], center: number): [BuildingModel, string] {
  const w = model.floors[0].walls.find((x) => x.id === wallId)!;
  const d = OPENING_DEFAULTS[kind];
  const width = Math.min(d.width, wallLength(w) - 50);
  const id = nextId(kind === "door" ? "D-" : kind === "window" ? "WIN-" : kind === "ventilator" ? "V-" : "O-", model.floors[0].openings.map((o) => o.id));
  const o: Opening = { id, wall: wallId, kind, offset: center - width / 2, width, height: d.height, sill: d.sill, side: 1 };
  return [withFloor(model, (f) => clampOpenings({ ...f, openings: [...f.openings, o] })), id];
}

export function updateOpening(model: BuildingModel, id: string, patch: Partial<Opening>) {
  return withFloor(model, (f) => clampOpenings({ ...f, openings: f.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
}

export function deleteOpening(model: BuildingModel, id: string) {
  return withFloor(model, (f) => ({ ...f, openings: f.openings.filter((o) => o.id !== id) }));
}

export function updateRoom(model: BuildingModel, id: string, patch: Partial<Room>) {
  return withFloor(model, (f) => ({ ...f, rooms: f.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}

export function setPlotSize(model: BuildingModel, width: number, depth: number): BuildingModel {
  return { ...model, plot: { ...model.plot, polygon: [[0, 0], [width, 0], [width, depth], [0, depth]] } };
}

/** The road is always drawn at the bottom; choosing its compass side rotates north to match. */
export function setRoadSide(model: BuildingModel, side: Side): BuildingModel {
  const base = { north: 0, east: 90, south: 180, west: 270 }[side];
  return { ...model, plot: { ...model.plot, road_sides: [side] }, north_deg: (180 - base + 360) % 360 };
}

/** A fresh project: an empty plot with Indian residential defaults. */
export function blankProject(template: BuildingModel, name: string, width = 30 * MM_PER_FT, depth = 40 * MM_PER_FT): BuildingModel {
  const ft = (v: number) => v * MM_PER_FT;
  return {
    ...template,
    name,
    plot: { polygon: [[0, 0], [width, 0], [width, depth], [0, depth]], road_sides: ["east"], road_width: ft(30), gate: null,
      setbacks: { front: ft(5), rear: ft(3), left: ft(3), right: ft(3) } },
    north_deg: 90,
    floors: [{ ...template.floors[0], walls: [], openings: [], rooms: [], furniture: [] }],
  };
}

/** Rectangle of exterior walls inside the setbacks: a one-click starting point. */
export function addOuterWalls(model: BuildingModel): BuildingModel {
  const xs = model.plot.polygon.map((p) => p[0]);
  const ys = model.plot.polygon.map((p) => p[1]);
  const sb = model.plot.setbacks;
  const t = EXT_THICKNESS / 2;
  const x0 = Math.min(...xs) + sb.left + t, x1 = Math.max(...xs) - sb.right - t;
  const y0 = Math.min(...ys) + sb.front + t, y1 = Math.max(...ys) - sb.rear - t;
  const corners: Point[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let m = model;
  for (let i = 0; i < 4; i++) [m] = addWall(m, corners[i], corners[(i + 1) % 4], "exterior");
  return m;
}
