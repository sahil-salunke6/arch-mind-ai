from pathlib import PurePath

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from .export_dxf import export_dxf
from .export_pdf import export_pdf
from .model import BuildingModel
from .rooms import detect_rooms
from .sketch.reader import read_sketch
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
    return Created(id=store.create(_with_rooms(model) if model else sample_project()))


@app.get("/api/projects/{id}")
def get_project(id: str) -> BuildingModel:
    if (model := store.get(id)) is None:
        raise HTTPException(404, "project not found")
    return model


@app.put("/api/projects/{id}")
def save_project(id: str, model: BuildingModel) -> BuildingModel:
    """Saves the model; rooms are re-derived from the walls and returned to the editor."""
    model = _with_rooms(model)
    if not store.save(id, model):
        raise HTTPException(404, "project not found")
    return model


MAX_UPLOAD = 15 * 1024 * 1024


class SketchReport(BaseModel):
    warnings: list[str]
    overlay: dict
    stats: dict


class SketchCreated(BaseModel):
    id: str
    report: SketchReport


@app.post("/api/sketch", status_code=201)
async def create_from_sketch(request: Request) -> SketchCreated:
    """Read a photo of a hand-drawn plan (raw image bytes in the body) into a new project."""
    data = await request.body()
    if not data:
        raise HTTPException(422, "Upload a photo of your sketch (JPG or PNG).")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image too large (max 15 MB).")
    name = PurePath(request.headers.get("x-filename", "Sketch")).stem[:60] or "Sketch"
    try:
        result = await run_in_threadpool(read_sketch, data, name)
    except ValueError as e:  # not an image, no walls found
        raise HTTPException(422, str(e)) from e
    pid = store.create(result.model)
    return SketchCreated(id=pid, report=SketchReport(warnings=result.warnings, overlay=result.overlay, stats=result.stats))


def _with_rooms(model: BuildingModel) -> BuildingModel:
    floors = [f.model_copy(update={"rooms": detect_rooms(f)}) for f in model.floors]
    return model.model_copy(update={"floors": floors})


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
