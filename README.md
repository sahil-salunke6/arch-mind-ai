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
GitHub Actions (`.github/workflows/ci.yml`) runs both on every pull request into `dev` or `main`.

## Reading a hand-drawn sketch

Upload a photo of a hand-drawn plan and press **Generate Design**. The API (`api/app/sketch/`):

1. flattens the page (phone photo of paper on a table) and removes shadows (`image.py`);
2. reads the handwriting with RapidOCR (PaddleOCR models on ONNX Runtime, CPU only): room names,
   sizes like `12' x 14'`, plot dimensions, margins, road side and gate (`text.py`);
3. finds straight pen strokes: single- or double-line walls, the plot boundary, stair treads; dimension
   arrows and the road are set aside (`lines.py`);
4. snaps walls to a grid and **solves the real positions from the written sizes** by least squares, since
   sketches are never to scale; drawn proportions only fill in where nothing is written. Written sizes
   that can't all be true are listed as warnings (`reader.py`);
5. turns short gaps into doorways, builds the walls, plot and setbacks, and names rooms from the labels.

The result opens as a normal project; fix anything that's off in the editor. Best results: plain paper,
dark pen, whole page in frame, sizes written for every room and the plot. Not yet read: windows (gaps
come out as doorways), Hindi handwriting, curved or angled walls.

## Exploring in 3D

- The 3D view's top-right switch picks **Auto / Roof / Cutaway / Doll-house**.
- **Go to** (bottom-left) jumps inside any room or outside at eye level; inside a room, drag to look around
  (up to the ceiling, down to the floor) and scroll to zoom. Double-clicking a room's floor does the same.
- **Walk**: drag the view to look around, W/↑ forward, S/↓ back, ←/→ turn, A/D step sideways, Shift to run
  (or hold the on-screen arrows). Walls stop you; doorways let you through, and you can walk up the stairs.
- **Close-ups**: double-click a wall (or use *Zoom into wall* in its panel) to see its layers, bricks in
  courses, conduit, pipes, lintel and DPC; click any part for its properties and choose another option.
  Floors (from a room's panel), the roof (from the summary), doors and windows have close-ups too.
  Options and typical values live in `web/src/lib/materials.ts` and are saved in the project's `specs`.

## Upper floors

- **+ Floor** (next to Compare / 2D Plan / 3D Model) adds a storey on top. The outer walls, their windows
  and the staircase walls carry up; the front door doesn't. Draw the inner rooms as on the ground floor;
  the floor below shows as faint dashed lines to line walls up with.
- The floor tabs pick which floor the 2D plan, the right panel and the close-ups work on. The Cutaway and
  Doll-house views show the chosen floor and the ones below; Roof and the straight elevations show the
  whole building. The bin icon deletes the chosen upper floor (undo brings it back).
- Each floor is `floor-to-floor height + slab` above the one below (`web/src/lib/floors.ts`,
  `api/app/export_pdf.py`). The PDF has a plan sheet per floor and stacks all storeys in the elevations and
  section; the DXF draws each floor plan beside the one below.

## Editing plans

In the 2D plan, choose a tool from the toolbar (keyboard shortcut in brackets):

- **Select (V)**: click a wall, door, window or room to edit it in the right panel. Drag a wall to slide it
  (joined walls stretch), drag its round end handles to resize it, drag doors/windows along their wall.
  Drag empty space to pan, scroll to zoom.
- **Wall (W)**: click to start, click for each corner; walls snap to 90°, to other walls and to 3" steps.
  Click the start point or double-click to finish, Esc to stop, hold Shift for any angle.
- **Door (D) / Window (N)**: click on a wall.
- **Doors & windows**: select one to pick a type (single, main, toilet, double, sliding or French door; casement,
  sliding, 3-panel, picture or kitchen window; ventilator; arch). Drag the small handles at its ends to resize it.
- **Furniture**: click a piece to select it, drag to move it; R turns it 90° (Shift+R the other way).
  Add furniture to a room from the room's panel (select the room, then *Add furniture*).
- Delete removes the selected wall, opening or furniture; Ctrl+Z / Ctrl+Y undo and redo.

Projects can be renamed and deleted from the **Projects** tab (pencil and bin icons).

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
