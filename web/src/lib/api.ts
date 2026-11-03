import type { BuildingModel } from "../types";

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
  dxfUrl: (id: string) => `/api/projects/${id}/export.dxf`,
  pdfUrl: (id: string) => `/api/projects/${id}/export.pdf`,
};
