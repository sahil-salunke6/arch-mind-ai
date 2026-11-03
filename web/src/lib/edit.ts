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

// --- furniture ---------------------------------------------------------------------------------

/** Footprint and height in feet for each furniture type the plan and 3D view can draw. */
export const FURNITURE: Record<string, { label: string; size: [number, number, number] }> = {
  bed_double: { label: "Double bed", size: [5, 6.5, 1.8] },
  bed_single: { label: "Single bed", size: [3, 6.5, 1.8] },
  wardrobe: { label: "Wardrobe", size: [5, 2, 7] },
  sofa: { label: "Sofa", size: [7, 3, 2.8] },
  coffee_table: { label: "Coffee table", size: [3.5, 2, 1.4] },
  tv_unit: { label: "TV unit", size: [6, 1.5, 2] },
  dining_table: { label: "Dining table", size: [6, 3.5, 2.5] },
  chair: { label: "Chair", size: [1.5, 1.5, 3] },
  kitchen_counter: { label: "Kitchen counter", size: [8, 2, 3] },
  wc: { label: "WC", size: [1.5, 2.2, 1.3] },
  car: { label: "Car", size: [6, 14, 4.8] },
};

export function addFurniture(model: BuildingModel, type: string, pos: Point): [BuildingModel, string] {
  const id = nextId("F-", model.floors[0].furniture.map((f) => f.id));
  const [w, d, h] = FURNITURE[type].size.map((v) => v * MM_PER_FT) as [number, number, number];
  return [withFloor(model, (f) => ({ ...f, furniture: [...f.furniture, { id, type, pos, rot: 0, size: [w, d, h] }] })), id];
}

export function updateFurniture(model: BuildingModel, id: string, patch: Partial<Floor["furniture"][number]>) {
  return withFloor(model, (f) => ({ ...f, furniture: f.furniture.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

export function rotateFurniture(model: BuildingModel, id: string, by: number) {
  const item = model.floors[0].furniture.find((x) => x.id === id)!;
  return updateFurniture(model, id, { rot: (((item.rot + by) % 360) + 360) % 360 });
}

export function deleteFurniture(model: BuildingModel, id: string) {
  return withFloor(model, (f) => ({ ...f, furniture: f.furniture.filter((x) => x.id !== id) }));
}

// --- door & window presets --------------------------------------------------------------------

export interface OpeningPreset {
  id: string;
  label: string;
  use: string; // where it's typically used, shown under the name
  kind: Opening["kind"];
  style: NonNullable<Opening["style"]>;
  size: [number, number, number]; // width, height, sill in feet
}

/** Common Indian residential sizes. */
export const OPENING_PRESETS: OpeningPreset[] = [
  { id: "door-single", label: "Single door", use: "Bedrooms, kitchen", kind: "door", style: "single", size: [3, 7, 0] },
  { id: "door-main", label: "Main door", use: "Entrance", kind: "door", style: "single", size: [3.5, 7, 0] },
  { id: "door-toilet", label: "Toilet door", use: "Toilets, store", kind: "door", style: "single", size: [2.5, 7, 0] },
  { id: "door-double", label: "Double door", use: "Living, puja, main", kind: "door", style: "double", size: [5, 7, 0] },
  { id: "door-sliding", label: "Sliding door", use: "Balcony, terrace", kind: "door", style: "sliding", size: [6, 7, 0] },
  { id: "door-french", label: "French door", use: "Garden, sit-out (glass)", kind: "door", style: "french", size: [5, 7, 0] },
  { id: "win-casement", label: "Casement window", use: "Two shutters, any room", kind: "window", style: "casement", size: [4, 4, 3] },
  { id: "win-sliding", label: "Sliding window", use: "Aluminium / uPVC", kind: "window", style: "sliding_window", size: [5, 4, 3] },
  { id: "win-three", label: "3-panel window", use: "Living, bedrooms", kind: "window", style: "three_panel", size: [6, 4, 3] },
  { id: "win-picture", label: "Picture window", use: "Fixed glass, views", kind: "window", style: "fixed", size: [6, 5, 2] },
  { id: "win-kitchen", label: "Kitchen window", use: "Above the counter", kind: "window", style: "sliding_window", size: [3, 3, 3.5] },
  { id: "vent", label: "Ventilator", use: "Toilets, stairs", kind: "ventilator", style: "louvered", size: [2, 1.5, 5.5] },
  { id: "arch", label: "Arch opening", use: "Passages, no door", kind: "opening", style: "arch", size: [4, 7, 0] },
];

/** Name shown in schedules and the inspector. */
export function openingLabel(o: Pick<Opening, "kind" | "style">): string {
  const byStyle: Record<string, string> = {
    single: "Single door", double: "Double door", sliding: "Sliding door", french: "French door",
    casement: "Casement window", sliding_window: "Sliding window", three_panel: "3-panel window", fixed: "Picture window",
    louvered: "Ventilator", arch: "Arch opening",
  };
  const byKind = { door: "Single door", window: "Casement window", ventilator: "Ventilator", opening: "Opening" };
  return (o.style && byStyle[o.style]) || byKind[o.kind];
}

/** Swap an opening for a preset, keeping it centred where it was on its wall. */
export function applyPreset(model: BuildingModel, id: string, preset: OpeningPreset) {
  const o = model.floors[0].openings.find((x) => x.id === id)!;
  const [w, h, sill] = preset.size.map((v) => v * MM_PER_FT);
  const height = Math.min(h, model.floors[0].height - sill);
  return updateOpening(model, id, {
    kind: preset.kind, style: preset.style, width: w, height, sill, offset: o.offset + o.width / 2 - w / 2,
  });
}
