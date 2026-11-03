// Mirrors api/app/model.py. All lengths in millimetres; plan y points away from the road.

export type Point = [number, number];
export type Side = "north" | "south" | "east" | "west";

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  thickness: number;
  type: "exterior" | "interior";
  assembly: string | null;
}

export type OpeningStyle =
  | "" | "single" | "double" | "sliding" | "french"
  | "casement" | "sliding_window" | "three_panel" | "fixed"
  | "louvered" | "arch";

export interface Opening {
  id: string;
  wall: string;
  kind: "door" | "window" | "opening" | "ventilator";
  style?: OpeningStyle;
  offset: number;
  width: number;
  height: number;
  sill: number;
  side: 1 | -1;
}

export type RoomType =
  | "bedroom" | "toilet" | "kitchen" | "living" | "dining" | "stair"
  | "parking" | "foyer" | "puja" | "utility" | "balcony" | "store" | "other";

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  polygon: Point[];
  label_raw: string | null;
}

export interface Furniture {
  id: string;
  type: string;
  pos: Point;
  rot: number;
  size: [number, number, number];
}

export interface Floor {
  level: number;
  height: number;
  slab: number;
  plinth: number;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: Furniture[];
}

export interface Assembly {
  id: string;
  name: string;
  function: string;
  layers: { name: string; material: string; thickness: number }[];
}

export interface BuildingModel {
  schema_version: number;
  name: string;
  display_units: "ft" | "m";
  north_deg: number;
  structure: string;
  plot: {
    polygon: Point[];
    road_sides: Side[];
    road_width: number | null;
    gate: [number, number] | null;
    setbacks: { front: number; rear: number; left: number; right: number };
  };
  floors: Floor[];
  roof: { type: string; parapet: number };
  assemblies: Record<string, Assembly>;
}

export type Selection = { kind: "wall" | "opening" | "room" | "furniture"; id: string } | null;
export type Tool = "select" | "wall" | "door" | "window";

export type ViewName = "North" | "South" | "East" | "West" | "NE" | "NW" | "SE" | "SW" | "Top" | "Bottom";
export const VIEWS: ViewName[] = ["North", "South", "East", "West", "NE", "NW", "SE", "SW", "Top", "Bottom"];

/** How much of the house the 3D view shows: auto picks roof for straight-on elevations, open otherwise. */
export type Cut = "auto" | "roof" | "open" | "doll";

export interface Layers {
  cut: Cut;
  furniture: boolean;
  labels: boolean;
  dimensions: boolean;
}
