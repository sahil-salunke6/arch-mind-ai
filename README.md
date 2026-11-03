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

## Editing plans

In the 2D plan, choose a tool from the toolbar (keyboard shortcut in brackets):

- **Select (V)**: click a wall, door, window or room to edit it in the right panel. Drag a wall to slide it
  (joined walls stretch), drag its round end handles to resize it, drag doors/windows along their wall.
  Drag empty space to pan, scroll to zoom.
- **Wall (W)**: click to start, click for each corner; walls snap to 90°, to other walls and to 3" steps.
  Click the start point or double-click to finish, Esc to stop, hold Shift for any angle.
- **Door (D) / Window (N)**: click on a wall.
- Delete removes the selected wall/opening; Ctrl+Z / Ctrl+Y undo and redo.

Changes autosave. On save the API re-derives rooms from closed wall loops (`api/app/rooms.py`), keeping
the names of rooms you already labelled. A blank plot starts from **Projects → Blank plot**.

## Layout

- `api/app/model.py`: BuildingModel, the single source of truth (millimetres)
- `api/app/units.py`: ft-in / metric parsing and formatting
- `api/app/sample.py`: sample 40x60 east-facing 3BHK
- `api/app/rooms.py`: rooms from closed wall loops
- `api/app/export_dxf.py`: layered DXF concept plan
- `api/app/export_pdf.py`: A3 PDF blueprint set (plan, elevations, section)
- `web/src/components/PlanView2D.tsx`: dimensioned 2D plan and editor (SVG)
- `web/src/lib/edit.ts`: pure edit operations; `web/src/lib/history.ts`: undo/redo
- `web/src/components/Viewer3D.tsx`: 3D model, 10 camera views, thumbnails
- `web/src/components/SketchView.tsx`: hand-drawn rendering of the model (demo input)

Project data lives in `api/data/archmind.db` (SQLite). Delete it to reset to the sample.
