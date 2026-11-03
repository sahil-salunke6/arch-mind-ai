# ArchMind AI

Turn a hand-drawn plot / floor-plan sketch into an editable 2D plan, a 3D model, 10 standard views
and a CAD concept drawing. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and roadmap.

## Run locally

Requires Python 3.12+ and Node 20+.

```bash
# API (http://127.0.0.1:8000)
cd api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python -m uvicorn app.main:app --reload

# Web (http://localhost:5173, proxies /api to the API)
cd web
npm install
npm run dev
```

Tests: `cd api && .venv/Scripts/python -m pytest`. Typecheck: `cd web && npm run typecheck`.

## Layout

- `api/app/model.py`: BuildingModel, the single source of truth (millimetres)
- `api/app/units.py`: ft-in / metric parsing and formatting
- `api/app/sample.py`: sample 40x60 east-facing 3BHK
- `api/app/export_dxf.py`: layered DXF concept plan
- `web/src/components/PlanView2D.tsx`: dimensioned 2D plan (SVG)
- `web/src/components/Viewer3D.tsx`: 3D model, 10 camera views, thumbnails
- `web/src/components/SketchView.tsx`: hand-drawn rendering of the model (demo input)

Project data lives in `api/data/archmind.db` (SQLite). Delete it to reset to the sample.
