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
  dxfUrl: (id: string) => `/api/projects/${id}/export.dxf`,
  pdfUrl: (id: string) => `/api/projects/${id}/export.pdf`,
};
