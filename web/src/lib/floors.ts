// Multi-storey helpers. Floors are stacked in model.floors order: 0 = ground.

import type { BuildingModel, Floor, Opening, Point, Room, Wall } from "../types";
import { pointOnWall, wallFrame, wallLength } from "./geometry";

const NAMES = ["Ground floor", "First floor", "Second floor", "Third floor", "Fourth floor"];
export const floorName = (i: number) => NAMES[i] ?? `Floor ${i}`;
export const floorShort = (i: number) => (i === 0 ? "G" : `${i}F`);

/** Height of a floor's finished level above ground (mm): plinth, then each storey below plus its slab. */
export function floorBase(model: BuildingModel, i: number): number {
  let h = model.floors[0].plinth;
  for (let j = 0; j < i && j < model.floors.length; j++) h += model.floors[j].height + model.floors[j].slab;
  return h;
}

/** The rise a stair on this floor climbs: up to the next level (or the terrace on the top floor). */
export const stairRise = (floor: Floor) => floor.height + floor.slab;

/**
 * The editor tools work on floors[0]. To edit another floor, hand them the model with that floor
 * moved to the front, and put the order back afterwards.
 */
export function activeFirst(model: BuildingModel, i: number): BuildingModel {
  if (i === 0) return model;
  const f = model.floors;
  return { ...model, floors: [f[i], ...f.slice(0, i), ...f.slice(i + 1)] };
}

export function restoreOrder(view: BuildingModel, i: number): BuildingModel {
  if (i === 0) return view;
  const v = view.floors;
  return { ...view, floors: [...v.slice(1, i + 1), v[0], ...v.slice(i + 1)] };
}

export function findRoom(model: BuildingModel, id: string): { room: Room; floor: number } | null {
  for (let i = 0; i < model.floors.length; i++) {
    const room = model.floors[i].rooms.find((r) => r.id === id);
    if (room) return { room, floor: i };
  }
  return null;
}

/** The stretch [s0, s1] of a wall that runs along one of the room's edges, if it is a real length. */
function alongRoom(w: Wall, room: Room): [number, number][] {
  const { u, n } = wallFrame(w);
  const len = wallLength(w);
  const out: [number, number][] = [];
  room.polygon.forEach((a, i) => {
    const b = room.polygon[(i + 1) % room.polygon.length];
    const off = (p: Point) => (p[0] - w.a[0]) * n[0] + (p[1] - w.a[1]) * n[1];
    if (Math.abs(off(a)) > 10 || Math.abs(off(b)) > 10) return; // not on this wall's line
    const sa = (a[0] - w.a[0]) * u[0] + (a[1] - w.a[1]) * u[1];
    const sb = (b[0] - w.a[0]) * u[0] + (b[1] - w.a[1]) * u[1];
    const s0 = Math.max(0, Math.min(sa, sb)), s1 = Math.min(len, Math.max(sa, sb));
    if (s1 - s0 > 300) out.push([s0, s1]);
  });
  return out;
}

/**
 * A new storey on top: the outer walls (with their windows) and the staircase walls carry up, so
 * the stair continues and you only draw the inner rooms.
 */
export function addFloor(model: BuildingModel): BuildingModel {
  const top = model.floors[model.floors.length - 1];
  const stairs = top.rooms.filter((r) => r.type === "stair");
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  for (const w of top.walls) {
    const own = top.openings.filter((o) => o.wall === w.id);
    if (w.type === "exterior") {
      walls.push(w);
      openings.push(...own.filter((o) => o.kind === "window" || o.kind === "ventilator")); // no front door upstairs
      continue;
    }
    // inner walls: only the part enclosing the stair, with its way out
    stairs.flatMap((r) => alongRoom(w, r)).forEach(([s0, s1], k) => {
      const whole = s0 < 1 && s1 > wallLength(w) - 1;
      const id = whole ? w.id : `${w.id}-S${k + 1}`;
      walls.push({ ...w, id, a: whole ? w.a : pointOnWall(w, s0), b: whole ? w.b : pointOnWall(w, s1) });
      openings.push(...own.filter((o) => o.offset >= s0 - 1 && o.offset + o.width <= s1 + 1)
        .map((o) => ({ ...o, id: whole ? o.id : `${o.id}-S`, wall: id, offset: o.offset - s0 })));
    });
  }
  const uid = () => `R-${Math.random().toString(16).slice(2, 10)}`;
  const floor: Floor = {
    ...top,
    level: model.floors.length,
    walls, openings,
    rooms: stairs.map((r) => ({ ...r, id: uid() })),
    furniture: [],
  };
  return { ...model, floors: [...model.floors, floor] };
}

export function removeFloor(model: BuildingModel, i: number): BuildingModel {
  if (i === 0 || model.floors.length < 2) return model;
  return { ...model, floors: model.floors.filter((_, j) => j !== i).map((f, j) => ({ ...f, level: j })) };
}
