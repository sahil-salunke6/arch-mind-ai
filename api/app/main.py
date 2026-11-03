from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

from .export_dxf import export_dxf
from .export_pdf import export_pdf
from .model import BuildingModel
from .sample import sample_project
from .store import ProjectStore

app = FastAPI(title="ArchMind AI API", version="0.1.0")
store = ProjectStore()


class Created(BaseModel):
    id: str


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/projects")
def list_projects() -> list[dict]:
    return store.list()


@app.post("/api/projects", status_code=201)
def create_project(model: BuildingModel | None = None) -> Created:
    return Created(id=store.create(model or sample_project()))


@app.get("/api/projects/{id}")
def get_project(id: str) -> BuildingModel:
    if (model := store.get(id)) is None:
        raise HTTPException(404, "project not found")
    return model


@app.put("/api/projects/{id}")
def save_project(id: str, model: BuildingModel) -> BuildingModel:
    if not store.save(id, model):
        raise HTTPException(404, "project not found")
    return model


def _attachment(model: BuildingModel, content: bytes, ext: str, media_type: str) -> Response:
    filename = model.name.replace("×", "x").encode("ascii", "ignore").decode().replace(" ", "_") or "plan"
    return Response(content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}.{ext}"'})


@app.get("/api/projects/{id}/export.dxf")
def project_dxf(id: str) -> Response:
    model = get_project(id)
    return _attachment(model, export_dxf(model), "dxf", "application/dxf")


@app.get("/api/projects/{id}/export.pdf")
def project_pdf(id: str) -> Response:
    model = get_project(id)
    return _attachment(model, export_pdf(model), "pdf", "application/pdf")
