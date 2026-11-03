import type { BuildingModel, Opening, Point, Room, Side, ViewName, Wall } from "../types";

export const MM_PER_FT = 304.8;

export function ftIn(mm: number): string {
  const inches = Math.round((mm / 25.4) * 2) / 2;
  const feet = Math.floor(inches / 12);
  const rest = inches - feet * 12;
  return rest === 0 ? `${feet}'` : `${feet}'-${rest}"`;
}

export const sqft = (mm2: number) => mm2 / MM_PER_FT ** 2;

export function polygonArea(pts: Point[]): number {
  let s = 0;
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  });
  return Math.abs(s) / 2;
}

export function bbox(pts: Point[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export const wallLength = (w: Wall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/** Unit direction along the wall and its left normal. */
export function wallFrame(w: Wall) {
  const len = wallLength(w);
  const u: Point = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
  const n: Point = [-u[1], u[0]];
  return { u, n, len };
}

export function pointOnWall(w: Wall, s: number, k = 0): Point {
  const { u, n } = wallFrame(w);
  return [w.a[0] + u[0] * s + n[0] * k, w.a[1] + u[1] * s + n[1] * k];
}

/** Solid stretches of a wall in plan; ends extend by half the thickness so corners close. */
export function solidSpans(w: Wall, openings: Opening[]): [number, number][] {
  const ext = w.thickness / 2;
  const cuts = openings.filter((o) => o.wall === w.id).map((o) => [o.offset, o.offset + o.width]).sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let cursor = -ext;
  for (const [s0, s1] of cuts) {
    if (s0 > cursor) spans.push([cursor, s0]);
    cursor = Math.max(cursor, s1);
  }
  const end = wallLength(w) + ext;
  if (end > cursor) spans.push([cursor, end]);
  return spans;
}

export function spanRect(w: Wall, s0: number, s1: number, k0 = -w.thickness / 2, k1 = w.thickness / 2): Point[] {
  return [pointOnWall(w, s0, k0), pointOnWall(w, s1, k0), pointOnWall(w, s1, k1), pointOnWall(w, s0, k1)];
}

/** Compass direction as a unit vector in plan coordinates. north_deg is clockwise from drawing-up. */
export function compass(model: BuildingModel, side: Side): Point {
  const base = { north: 0, east: 90, south: 180, west: 270 }[side];
  const a = ((model.north_deg + base) * Math.PI) / 180;
  return [Math.sin(a), Math.cos(a)];
}

export function viewDirection(model: BuildingModel, view: ViewName): Point | null {
  const sides: Record<string, Side[]> = {
    North: ["north"], South: ["south"], East: ["east"], West: ["west"],
    NE: ["north", "east"], NW: ["north", "west"], SE: ["south", "east"], SW: ["south", "west"],
  };
  const list = sides[view];
  if (!list) return null;
  const v = list.map((s) => compass(model, s)).reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as Point, [0, 0] as Point);
  const len = Math.hypot(v[0], v[1]);
  return [v[0] / len, v[1] / len];
}

export function footprint(model: BuildingModel) {
  const all = model.floors[0].walls;
  const ext = all.some((w) => w.type === "exterior") ? all.filter((w) => w.type === "exterior") : all;
  if (!ext.length) {
    const p = bbox(model.plot.polygon);
    return { ...p, x0: p.cx, x1: p.cx, y0: p.cy, y1: p.cy, w: 0, h: 0 };
  }
  const t = Math.max(...ext.map((w) => w.thickness)) / 2;
  const b = bbox(ext.flatMap((w) => [w.a, w.b]));
  return { ...b, x0: b.x0 - t, x1: b.x1 + t, y0: b.y0 - t, y1: b.y1 + t, w: b.w + 2 * t, h: b.h + 2 * t };
}

export function roomSize(room: Room) {
  const b = bbox(room.polygon);
  return `${ftIn(b.w)} × ${ftIn(b.h)}`;
}

export function summary(model: BuildingModel) {
  const floor = model.floors[0];
  const plot = bbox(model.plot.polygon);
  const fp = footprint(model);
  const count = (t: string) => floor.rooms.filter((r) => r.type === t);
  return {
    plot,
    plotArea: sqft(polygonArea(model.plot.polygon)),
    builtUp: sqft(fp.w * fp.h),
    bedrooms: count("bedroom").length,
    toilets: count("toilet").length,
    parking: count("parking"),
    facing: model.plot.road_sides.map((s) => s[0].toUpperCase() + s.slice(1)).join(", "),
  };
}

export const ROOM_COLORS: Record<string, string> = {
  bedroom: "#fde3c8", toilet: "#cfe5f6", kitchen: "#fdf6e6", living: "#fbf3e8", dining: "#fbf3e8",
  stair: "#ececf1", parking: "#ebebeb", foyer: "#f6efe6", puja: "#fff1c9", utility: "#e8eef0",
  balcony: "#e9f3e3", store: "#efe9e1",
};

export interface Tread {
  rect: [number, number, number, number]; // x0, y0, x1, y1
  top: number; // height of the tread surface above floor level
  flight: 0 | 1 | -1; // -1 = landing
}

/** Dog-leg stair filling a room: two flights along the long side with a landing at the far end. */
export function stairLayout(room: Room, rise: number): Tread[] {
  const b = bbox(room.polygon);
  const alongX = b.w >= b.h;
  const long = alongX ? b.w : b.h;
  const short = alongX ? b.h : b.w;
  const landing = short / 2;
  const run = long - landing;
  const n = Math.max(5, Math.round(run / 250));
  const tread = run / n;
  const r = rise / (2 * n + 1);
  const out: Tread[] = [];
  const rect = (l0: number, l1: number, s0: number, s1: number): Tread["rect"] =>
    alongX ? [b.x0 + l0, b.y0 + s0, b.x0 + l1, b.y0 + s1] : [b.x0 + s0, b.y0 + l0, b.x0 + s1, b.y0 + l1];
  for (let i = 0; i < n; i++) out.push({ rect: rect(i * tread, (i + 1) * tread, 0, short / 2), top: (i + 1) * r, flight: 0 });
  out.push({ rect: rect(run, long, 0, short), top: (n + 1) * r, flight: -1 });
  for (let i = 0; i < n; i++)
    out.push({ rect: rect(run - (i + 1) * tread, run - i * tread, short / 2, short), top: (n + 2 + i) * r, flight: 1 });
  return out;
}

/** Area-weighted centroid (falls back to the bbox centre for degenerate shapes). */
export function centroid(pts: Point[]): Point {
  let a = 0, cx = 0, cy = 0;
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  });
  if (Math.abs(a) < 1e-6) { const b = bbox(pts); return [b.cx, b.cy]; }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Distance along the wall of the foot of the perpendicular from p, and that distance from the wall line. */
export function projectOnWall(w: Wall, p: Point): { s: number; dist: number } {
  const { u, n } = wallFrame(w);
  const dx = p[0] - w.a[0], dy = p[1] - w.a[1];
  return { s: dx * u[0] + dy * u[1], dist: Math.abs(dx * n[0] + dy * n[1]) };
}
