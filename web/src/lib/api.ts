import type { BuildingModel } from "../types";

export interface SketchReport {
  warnings: string[];
  stats: { walls: number; rooms: number; labels_read: number; sizes_used: number; named_rooms: number; page_flattened: boolean };
  overlay: {
    width: number;
    height: number;
    image: string | null;
    walls: [number, number, number, number][];
    plot: [number, number, number, number] | null;
    stairs: [number, number, number, number][];
    ignored: [number, number, number, number][];
    labels: { text: string; role: string; box: [number, number][] }[];
  };
}

export interface ProjectInfo {
  id: string;
  name: string;
  updated_at: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  list: () => fetch("/api/projects").then((r) => json<ProjectInfo[]>(r)),
  get: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<BuildingModel>(r)),
  createFromSample: () =>
    fetch("/api/projects", { method: "POST" }).then((r) => json<{ id: string }>(r)),
  create: (model: BuildingModel) =>
    fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) })
      .then((r) => json<{ id: string }>(r)),
  /** Returns the saved model; rooms are re-derived from the walls on the server. */
  save: (id: string, model: BuildingModel) =>
    fetch(`/api/projects/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(model) })
      .then((r) => json<BuildingModel>(r)),
  /** Upload a sketch photo; the server reads it into a new project. */
  readSketch: async (file: File) => {
    const res = await fetch("/api/sketch", {
      method: "POST",
      headers: { "Content-Type": file.type || "image/jpeg", "X-Filename": encodeURIComponent(file.name) },
      body: file,
    });
    if (!res.ok) {
      const detail = await res.json().then((b) => b.detail).catch(() => res.statusText);
      throw new Error(typeof detail === "string" ? detail : res.statusText);
    }
    return res.json() as Promise<{ id: string; report: SketchReport }>;
  },
  dxfUrl: (id: string) => `/api/projects/${id}/export.dxf`,
  pdfUrl: (id: string) => `/api/projects/${id}/export.pdf`,
};
