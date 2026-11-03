# ArchMind AI — Architecture & Roadmap

Free web app: upload a hand-drawn plot / floor-plan sketch → get an editable 2D plan, a 3D model,
10 standard views, and a dimensioned concept blueprint. Prompt-to-design follows in a later phase.

## 0. Decisions (v1)

| Decision | Choice | Consequence |
|---|---|---|
| Region | **India** | ft-in units first, Indian plot conventions, NBC 2016 + one city's bye-laws, optional vastu, Devanagari labels |
| Team | **Solo developer** | One monorepo, few services, no microservices, buy-not-build wherever possible |
| First release | **Sketch → 3D** | Prompt-to-design becomes Phase 3 |
| Compute budget | **Undecided** | Phases 0–2 must run **without a GPU**. GPU is an upgrade path, not a requirement (§6) |

---

## 1. Core design decision

**Do not generate the views with an image model.** Diffusion models invent geometry, so the views won't
agree with each other and the measurements will be wrong.

Every input becomes **one structured BuildingModel** (JSON). All outputs are *rendered* from it:

```
 Sketch photo ─► BuildingModel (JSON) ──┬─► 2D plan (SVG, editable)
                 walls, openings, rooms,├─► 3D model (glTF, in-browser)
                 dimensions, furniture  ├─► 10 views (camera presets)
                                        ├─► Concept blueprint (PDF / DXF)
                                        └─► Photoreal render (optional, later)
```

### BuildingModel, with Indian defaults

```jsonc
{
  "units": "ft",                  // internal storage in mm; display ft-in or m
  "north": 0,                     // degrees, from the north arrow or asked from the user
  "plot": {
    "polygon": [[0,0],[30,0],[30,40],[0,40]],   // a "30x40" site
    "road_sides": ["east"],       // east-facing plot: drives the elevation naming and vastu hints
    "setbacks": {"front": 5, "rear": 3, "left": 3, "right": 3}
  },
  "floors": [{
    "level": 0, "height": 10,     // 10 ft floor-to-floor is the default
    "walls": [{ "id": "w1", "a": [0,0], "b": [30,0],
                "thickness": 0.75, // 9" (230 mm) exterior brick; interior default 4.5" (115 mm)
                "type": "exterior" }],
    "openings": [{ "wall": "w1", "kind": "door", "offset": 12, "width": 3.5, "height": 7 }],
    "rooms": [{ "name": "Kitchen", "label_raw": "रसोई", "polygon": [...], "area": 96 }],
    "features": [{ "type": "staircase", "polygon": [...] }],   // also: sump, OHT, parking, puja, balcony
    "furniture": [{ "type": "sofa_3s", "pos": [8,10], "rot": 90 }]
  }],
  "roof": { "type": "flat_rcc", "parapet": 3 },
  "structure": "rcc_frame"        // RCC frame + brick infill, typical G / G+1 / G+2
}
```

---

## 2. India specifics

**Dimension formats the parser must read:** `12'6"`, `12'-6"`, `12.5'`, `12 ft`, `3.81m`, `3810`
(mm), `30x40`, `30'x40'`, `9"` (wall), and area in `sq ft` / `sq yd (gaj)` / `sq m`. All are normalized
to mm internally.

**Labels:** English plus Hindi/Devanagari at launch (`रसोई`, `शयन कक्ष`, `पूजा`); more scripts later.
Common abbreviations: `BR`, `MBR`, `K`, `T`/`WC`, `D`, `LR`, `OTS`, `UP` (stair arrow).

**Rooms/features to recognize:** bedroom, master bedroom, kitchen, hall/living, dining, puja,
toilet/bath, utility/wash, store, balcony, sit-out, portico, car parking, staircase, sump, OHT, compound wall, gate.

**Rules (RAG corpus, phased):**
- v1: National Building Code of India 2016 minimums (room sizes, ceiling heights, stair widths) as
  **indicative** checks.
- v2: one city's bye-laws (setbacks by plot size and road width, FAR/FSI, ground coverage). Pick the city
  you know best; add more cities one at a time.
- Vastu: an **optional advisory overlay** (kitchen SE, puja NE, and so on), never enforced.

**Views:** name elevations by compass direction and also by "Front (road side)". Indian users think
"front elevation" first.

---

## 3. Sketch → BuildingModel pipeline (CPU-friendly v1)

| Step | v1: no GPU, no training | v2: own models (Phase 4) |
|---|---|---|
| 1. Pre-process | OpenCV: find page edges, perspective-warp, shadow removal, adaptive threshold | same |
| 2. Wall detection | Morphology + Hough lines + line merging; thick strokes = walls | Fine-tuned segmentation model |
| 3. Text detection & OCR | PaddleOCR (CPU) for printed and neat handwriting; regex parser for dimension strings | Fine-tuned handwriting OCR (dimensions + Devanagari) |
| 4. Vectorize | Skeletonize → segments → snap to 0/90° (configurable) → close loops → room polygons (shapely) | same |
| 5. Dimension solver | Attach each label to its nearest wall/edge; least-squares solve so that **written numbers beat drawn proportions**; report conflicts | same |
| 6. Semantics | Room-label keyword match (EN + HI dictionary); door arcs detected by template matching | Small VLM (quantized) for notes and ambiguous symbols |
| 7. Review screen | Overlay on the photo; user drags walls, fixes numbers, renames rooms | Corrections become training data (opt-in) |

**Review screen = the safety net.** Sketch reading in v1 will be imperfect, so the correction UI has to be
fast and pleasant: click a wall to type its length, drag to move it, tap a room to rename it. A good editor
makes a 70%-accurate parser feel like magic.

**Capture tips shown before upload:** plain white paper, dark pen, whole page in frame, no harsh shadows,
write the dimensions on each side.

---

## 4. Outputs

- **2D plan:** SVG from the model, with Indian-style dimension chains (ft-in) and room areas in sq ft.
- **3D:** procedural wall extrusion with door/window cut-outs, slab, parapet, stair block, in
  React Three Fiber. Simple material presets (plaster, brick, tile).
- **10 views:** Top (plan), Bottom, North, South, East, West (orthographic) + NE, NW, SE, SW (isometric).
  These are fixed camera rigs, so they are consistent by construction. Export a PNG per view, or one sheet.
- **Concept blueprint (PDF + DXF):** plan, 4 elevations, 1 section, door/window schedule, area statement,
  title block. Generated with `ezdxf` (DXF) and SVG → PDF.
- Every sheet carries: *"Concept drawing only. Not for construction or approval. Structural design and
  sanction drawings require a licensed architect/engineer."*

---

## 5. Stack (solo-sized)

| Layer | Choice |
|---|---|
| Frontend | Next.js + TypeScript, Tailwind, React Three Fiber, Konva (2D editor) |
| Backend | FastAPI (Python), one service |
| Jobs | One worker process with RQ + Redis (sketch parsing, PDF/DXF export) |
| Data | Postgres (pgvector added in Phase 3), local disk → S3-compatible storage at launch |
| Geometry/CV | OpenCV, numpy, scipy, shapely, ezdxf, PaddleOCR |
| Shared schema | Pydantic models → generated TypeScript types (one source of truth) |
| Dev/deploy | Docker Compose; a single VPS at launch |

```
arch-mind-ai/
├─ web/            # Next.js app: wizard, review editor, 3D viewer
├─ api/            # FastAPI + worker
│  ├─ app/         # routes, jobs, storage
│  ├─ model/       # BuildingModel (pydantic)
│  ├─ sketch/      # pipeline steps 1–6
│  ├─ geometry/    # solver, extrusion helpers
│  └─ export/      # SVG, PDF, DXF
├─ ml/             # later: synthetic sketch generator, training
├─ rag/            # later: corpus + retrieval
└─ docker-compose.yml
```

---

## 6. Compute tiers (choose later; the design works on all three)

| Tier | What runs | Rough cost |
|---|---|---|
| **A. CPU only** | Everything in Phases 0–2 (classic CV + PaddleOCR). 3D/views in the browser | One VPS |
| **B. One GPU (local or rented)** | + small quantized VLM for semantics, + training runs | One 24 GB GPU, or hourly rental for training only |
| **C. Cloud GPU serving** | + LLM prompt-to-design, photoreal renders at scale | Usage-based; needs rate limits / funding |

Free-tier protection from day one: per-IP daily limits, image-hash caching, max image size, job queue.

---

## 7. "Our own LLM and RAG", phased for a solo builder

1. **Phase 0–2:** no LLM needed. The parsing is CV + OCR + rules. This is already "own" tech.
2. **Phase 3:** self-host an open-weight LLM (quantized, via vLLM or llama.cpp) for prompt → requirements
   spec. Build RAG over NBC 2016 + one city's bye-laws with pgvector.
3. **Phase 4:** train your own models: (a) a **synthetic hand-drawn dataset**: render CubiCasa5K / RPLAN-style
   plans with wobbly lines, handwritten ft-in labels, Devanagari room names and phone-photo distortion;
   (b) a segmentation model and a handwriting-OCR model trained on that data plus opted-in user corrections;
   (c) a LoRA fine-tune of the LLM/VLM. Check dataset licences before commercial use.

Training a foundation LLM from scratch is out of scope. The small vision models plus the data flywheel are
the real IP.

---

## 8. Roadmap with "done when" criteria

### Phase 0: output chain, no AI (≈3 wks)
- [ ] Monorepo, Docker Compose, Pydantic BuildingModel + TS type generation
- [ ] 2D editor: draw a plot, walls, doors, windows; type exact ft-in lengths
- [ ] 3D extrusion + 10 camera presets + PNG export
- [ ] PDF/DXF concept sheet with dimensions and disclaimer
- **Done when:** someone can draw a 30x40 2BHK by hand in the editor and download its views and a DXF that opens in AutoCAD/LibreCAD.

### Phase 1: sketch reading (≈4–6 wks)
- [ ] Upload + capture tips + pre-processing
- [ ] Wall detection, OCR, dimension parser (all formats in §2), solver
- [ ] Review screen overlaid on the photo
- [ ] Test set: 30 real hand sketches (draw your own + ask friends/family), measure wall and dimension accuracy
- **Done when:** on the test set, ≥80% of walls are found and a user can fix the rest in <2 minutes.

### Phase 2: public beta (≈2–3 wks)
- [ ] Wizard UX (Upload → Check → Explore), mobile-friendly, English + Hindi UI
- [ ] Rate limits, caching, share link per project, basic analytics
- [ ] NBC minimum-size warnings (rule table, no LLM yet)
- **Done when:** deployed on one VPS, free, no login required for a first try.

### Phase 3: prompt-to-design
- Prompt → requirements spec (self-hosted LLM) → CP-SAT layout generator → 3–5 options → chat edits → finalize to blueprint. RAG over bye-laws for setback/FAR checks. Optional vastu overlay.

### Phase 4: own models + wow layer
- Synthetic dataset, own segmentation/OCR, VLM LoRA; photoreal renders (ControlNet on depth/edges), furniture auto-placement, G+1/G+2, rough BOQ/cost estimate.
