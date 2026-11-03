import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DoorOpen, Hand, Maximize, MousePointer2, PenLine, Redo2, Square, Undo2 } from "lucide-react";
import type { BuildingModel, Furniture, Layers, Opening, Point, Selection, Tool, Wall } from "../types";
import {
  bbox, centroid, ftIn, pointOnWall, projectOnWall, ROOM_COLORS, roomSize, solidSpans, spanRect, stairLayout, wallLength,
} from "../lib/geometry";
import { addOpening, addOuterWalls, addWall, moveEndpoint, moveWall, updateFurniture, updateOpening } from "../lib/edit";

const PAD = 2600;
const ROAD = 2400;
const GRID = 76.2; // 3": lengths snap to clean ft-in values
const BRAND = "#6a45f5";

/** Plan y points up; SVG y points down. */
const P = ([x, y]: Point) => [x, -y] as const;
const pts = (list: Point[]) => list.map((p) => P(p).join(",")).join(" ");

interface Props {
  model: BuildingModel;
  layers: Layers;
  selection: Selection;
  onSelect: (s: Selection) => void;
  editable?: boolean;
  tool?: Tool;
  onTool?: (t: Tool) => void;
  /** commit=true starts a new undo step; false replaces the current one (drag in progress). */
  onEdit?: (next: BuildingModel, commit: boolean) => void;
  history?: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
}

type Drag =
  | { kind: "pan"; start: [number, number]; vb: ViewBox; moved: boolean; roomId: string | null }
  | { kind: "endpoint"; wallId: string; end: "a" | "b"; original: BuildingModel; moved: boolean }
  | { kind: "wall"; wallId: string; start: Point; original: BuildingModel; moved: boolean }
  | { kind: "opening"; id: string; grab: number; original: BuildingModel; moved: boolean }
  | { kind: "opening-end"; id: string; end: "start" | "end"; original: BuildingModel; moved: boolean }
  | { kind: "furniture"; id: string; start: Point; pos0: Point; original: BuildingModel; moved: boolean };

type ViewBox = { x: number; y: number; w: number; h: number };

export default function PlanView2D(props: Props) {
  const { model, layers, selection, onSelect, editable = false, tool = "select" } = props;
  const floor = model.floors[0];
  const plot = bbox(model.plot.polygon);
  const svgRef = useRef<SVGSVGElement>(null);
  const fit = useCallback((): ViewBox => ({ x: plot.x0 - PAD, y: -(plot.y1 + PAD), w: plot.w + 2 * PAD, h: plot.h + 2 * PAD + ROAD }),
    [plot.x0, plot.y1, plot.w, plot.h]);
  const [vb, setVb] = useState<ViewBox>(fit);
  const [chain, setChain] = useState<{ origin: Point; last: Point } | null>(null);
  const [cursor, setCursor] = useState<{ p: Point; snap: string } | null>(null);
  const [hover, setHover] = useState<{ wallId: string; s: number } | null>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => setVb(fit()), [fit]);
  useEffect(() => { setChain(null); setHover(null); }, [tool]);

  // --- coordinates -----------------------------------------------------------------------------
  const toModel = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, -p.y];
  };
  const mmPerPx = () => {
    const el = svgRef.current;
    return el ? Math.max(vb.w / el.clientWidth, vb.h / el.clientHeight) : 20;
  };

  const snap = (raw: Point, from: Point | null, free: boolean): { p: Point; snap: string } => {
    const tol = 12 * mmPerPx();
    let p: Point = raw;
    if (from && !free) p = Math.abs(raw[0] - from[0]) >= Math.abs(raw[1] - from[1]) ? [raw[0], from[1]] : [from[0], raw[1]];
    const ends = floor.walls.flatMap((w) => [w.a, w.b]);
    const end = ends.find((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) < tol && (!from || free || Math.abs(e[0] - from[0]) < tol || Math.abs(e[1] - from[1]) < tol));
    if (end) return { p: end, snap: "end" };
    for (const w of floor.walls) {
      const { s, dist } = projectOnWall(w, p);
      if (dist > tol || s < 0 || s > wallLength(w)) continue;
      const onWall = pointOnWall(w, s);
      if (from && !free) {
        // keep the drawing axis; slide the free coordinate onto the wall
        const horizontal = p[1] === from[1];
        const wallVertical = Math.abs(w.a[0] - w.b[0]) < 1, wallHorizontal = Math.abs(w.a[1] - w.b[1]) < 1;
        if (horizontal && wallVertical) return { p: [w.a[0], p[1]], snap: "wall" };
        if (!horizontal && wallHorizontal) return { p: [p[0], w.a[1]], snap: "wall" };
        continue;
      }
      return { p: onWall, snap: "wall" };
    }
    const round = (v: number, o = 0) => o + Math.round((v - o) / GRID) * GRID;
    return { p: from ? [round(p[0], from[0]), round(p[1], from[1])] : [round(p[0]), round(p[1])], snap: "grid" };
  };

  // --- wheel zoom (non-passive so the page doesn't scroll) ------------------------------------
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [mx, my] = toModel(e.clientX, e.clientY);
      const k = Math.pow(1.0015, e.deltaY);
      setVb((v) => {
        const w = Math.min(Math.max(v.w * k, 2000), 200000), h = (v.h * w) / v.w;
        return { x: mx - ((mx - v.x) * w) / v.w, y: -my - ((-my - v.y) * h) / v.h, w, h };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // --- keyboard -------------------------------------------------------------------------------
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      if (e.key === "Escape") { if (chain) setChain(null); else { props.onTool?.("select"); onSelect(null); } }
      const keys: Record<string, Tool> = { v: "select", w: "wall", d: "door", n: "window" };
      if (!e.ctrlKey && !e.metaKey && keys[e.key.toLowerCase()]) props.onTool?.(keys[e.key.toLowerCase()]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- pointer handling -----------------------------------------------------------------------
  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    drag.current = d;
  };

  const onBackgroundDown = (e: React.PointerEvent, roomId: string | null = null) => {
    if (e.button === 1 || tool === "select" || !editable) {
      svgRef.current?.setPointerCapture(e.pointerId);
      drag.current = { kind: "pan", start: [e.clientX, e.clientY], vb, moved: false, roomId };
      return;
    }
    if (tool === "wall") {
      const { p } = snap(toModel(e.clientX, e.clientY), chain?.last ?? null, e.shiftKey);
      if (!chain) return setChain({ origin: p, last: p });
      if (Math.hypot(p[0] - chain.last[0], p[1] - chain.last[1]) < 100) return;
      const near = (q: Point, r: Point) => Math.hypot(q[0] - r[0], q[1] - r[1]) < 1;
      const exists = floor.walls.some((w) => (near(w.a, chain.last) && near(w.b, p)) || (near(w.b, chain.last) && near(w.a, p)));
      if (!exists) props.onEdit?.(addWall(model, chain.last, p, "interior")[0], true);
      const closed = Math.hypot(p[0] - chain.origin[0], p[1] - chain.origin[1]) < 1;
      setChain(closed ? null : { origin: chain.origin, last: p });
    }
  };

  const onWallDown = (e: React.PointerEvent, w: Wall) => {
    if (!editable) { e.stopPropagation(); return onSelect({ kind: "wall", id: w.id }); }
    if (tool === "wall") { e.stopPropagation(); return onBackgroundDown(e); }
    if (tool === "door" || tool === "window") {
      e.stopPropagation();
      const { s } = projectOnWall(w, toModel(e.clientX, e.clientY));
      const [next, id] = addOpening(model, w.id, tool, s);
      props.onEdit?.(next, true);
      props.onTool?.("select");
      return onSelect({ kind: "opening", id });
    }
    onSelect({ kind: "wall", id: w.id });
    startDrag(e, { kind: "wall", wallId: w.id, start: toModel(e.clientX, e.clientY), original: model, moved: false });
  };

  const onOpeningDown = (e: React.PointerEvent, o: Opening) => {
    e.stopPropagation();
    onSelect({ kind: "opening", id: o.id });
    if (!editable || tool !== "select") return;
    const w = floor.walls.find((x) => x.id === o.wall)!;
    const { s } = projectOnWall(w, toModel(e.clientX, e.clientY));
    startDrag(e, { kind: "opening", id: o.id, grab: s - o.offset, original: model, moved: false });
  };

  const onFurnitureDown = (e: React.PointerEvent, f: Furniture) => {
    if (editable && tool === "wall") { e.stopPropagation(); return onBackgroundDown(e); }
    e.stopPropagation();
    onSelect({ kind: "furniture", id: f.id });
    if (!editable || tool !== "select") return;
    startDrag(e, { kind: "furniture", id: f.id, start: toModel(e.clientX, e.clientY), pos0: f.pos, original: model, moved: false });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const raw = toModel(e.clientX, e.clientY);
    if (!d) {
      if (tool === "wall") setCursor(snap(raw, chain?.last ?? null, e.shiftKey));
      if ((tool === "door" || tool === "window") && !(e.target as Element).hasAttribute("data-wall")) setHover(null);
      return;
    }
    const emit = (next: BuildingModel) => { props.onEdit?.(next, !d.moved); d.moved = true; };
    if (d.kind === "pan") {
      const k = mmPerPx();
      const dx = (e.clientX - d.start[0]) * k, dy = (e.clientY - d.start[1]) * k;
      if (Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) > 3) d.moved = true;
      setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy });
    } else if (d.kind === "endpoint") {
      const w = d.original.floors[0].walls.find((x) => x.id === d.wallId)!;
      const other = d.end === "a" ? w.b : w.a;
      const { p } = snap(raw, other, e.shiftKey);
      emit(moveEndpoint(model, d.wallId, d.end, p, d.original));
    } else if (d.kind === "wall") {
      const delta: Point = [raw[0] - d.start[0], raw[1] - d.start[1]];
      if (!d.moved && Math.hypot(delta[0], delta[1]) < 4 * mmPerPx()) return;
      const rounded: Point = [Math.round(delta[0] / GRID) * GRID, Math.round(delta[1] / GRID) * GRID];
      emit(moveWall(model, d.wallId, rounded, d.original));
    } else if (d.kind === "furniture") {
      const dx = raw[0] - d.start[0], dy = raw[1] - d.start[1];
      if (!d.moved && Math.hypot(dx, dy) < 4 * mmPerPx()) return;
      const pos: Point = [d.pos0[0] + Math.round(dx / GRID) * GRID, d.pos0[1] + Math.round(dy / GRID) * GRID];
      emit(updateFurniture(d.original, d.id, { pos }));
    } else if (d.kind === "opening-end") {
      // drag one jamb along the wall; the other stays put (min 1'-6", stays on the wall)
      const o = d.original.floors[0].openings.find((x) => x.id === d.id)!;
      const w = d.original.floors[0].walls.find((x) => x.id === o.wall)!;
      const s = Math.round(projectOnWall(w, raw).s / GRID) * GRID;
      const MIN = 457.2;
      const patch = d.end === "start"
        ? (() => { const s0 = Math.min(Math.max(0, s), o.offset + o.width - MIN); return { offset: s0, width: o.offset + o.width - s0 }; })()
        : { width: Math.min(Math.max(MIN, s - o.offset), wallLength(w) - o.offset) };
      emit(updateOpening(d.original, d.id, patch));
    } else if (d.kind === "opening") {
      const o = d.original.floors[0].openings.find((x) => x.id === d.id)!;
      const w = d.original.floors[0].walls.find((x) => x.id === o.wall)!;
      const { s } = projectOnWall(w, raw);
      const offset = Math.round((s - d.grab) / GRID) * GRID;
      if (offset !== o.offset) emit(updateOpening(d.original, d.id, { offset }));
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "pan" && !d.moved) onSelect(d.roomId ? { kind: "room", id: d.roomId } : null);
  };

  const onDouble = () => { if (tool === "wall") setChain(null); };

  // --- derived --------------------------------------------------------------------------------
  const sb = model.plot.setbacks;
  const walls = useMemo(() => new Map(floor.walls.map((w) => [w.id, w])), [floor.walls]);
  const road = model.plot.road_sides.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ");
  const px = mmPerPx();
  const selWall = selection?.kind === "wall" ? walls.get(selection.id) : undefined;
  const selOpening = selection?.kind === "opening" ? floor.openings.find((o) => o.id === selection.id) : undefined;
  const preview = chain && cursor ? { a: chain.last, b: cursor.p } : null;
  const cursorStyle = !editable ? "default" : tool === "select" ? (drag.current?.kind === "pan" ? "grabbing" : "default") : "crosshair";

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="h-full w-full touch-none select-none"
        style={{ cursor: cursorStyle }}
        onPointerDown={(e) => onBackgroundDown(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { setCursor(null); setHover(null); }}
        onDoubleClick={onDouble}
      >
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#3b3a4a" />
          </marker>
        </defs>

        {/* Road */}
        <rect x={plot.x0 - PAD * 0.6} y={-plot.y0 + 700} width={plot.w + PAD * 1.2} height={ROAD - 300} rx={200} fill="#d9d9de" />
        <text x={plot.cx} y={-plot.y0 + 700 + (ROAD - 300) / 2} textAnchor="middle" dominantBaseline="middle" fontSize={420} fontWeight={600} fill="#3b3a4a">
          Road ({road})
        </text>

        {/* Plot + setback garden */}
        <polygon points={pts(model.plot.polygon)} fill="#e5f1dc" stroke="#6f8a63" strokeWidth={50} />
        <rect x={plot.x0 + sb.left} y={-(plot.y1 - sb.rear)} width={plot.w - sb.left - sb.right} height={plot.h - sb.front - sb.rear}
          fill="#fafaf7" stroke="#8a8a96" strokeWidth={25} strokeDasharray="160 110" />
        {model.plot.gate && (
          <line x1={model.plot.gate[0]} x2={model.plot.gate[0] + model.plot.gate[1]} y1={-plot.y0} y2={-plot.y0} stroke="#fafaf7" strokeWidth={140} />
        )}
        {[[plot.x0 + 1300, plot.y0 + 1300], [plot.x1 - 1300, plot.y0 + 1300], [plot.x0 + 1300, plot.y1 - 1300], [plot.x1 - 1300, plot.y1 - 1300]].map(([x, y], i) => (
          <g key={i} pointerEvents="none">
            <circle cx={x} cy={-y} r={650} fill="#7fb069" opacity={0.9} />
            <circle cx={x - 150} cy={-y - 150} r={330} fill="#97c47f" />
          </g>
        ))}

        {/* Rooms */}
        {floor.rooms.map((r) => (
          <polygon key={r.id} points={pts(r.polygon)} fill={ROOM_COLORS[r.type] ?? "#f4f4f4"}
            stroke={selection?.kind === "room" && selection.id === r.id ? BRAND : "none"} strokeWidth={6 * px}
            onPointerDown={(e) => { e.stopPropagation(); onBackgroundDown(e, r.id); }} />
        ))}
        {floor.rooms.filter((r) => r.type === "stair").flatMap((r) =>
          stairLayout(r, floor.height).map((t, i) => (
            <rect key={`${r.id}-${i}`} x={t.rect[0]} y={-t.rect[3]} width={t.rect[2] - t.rect[0]} height={t.rect[3] - t.rect[1]}
              fill={t.flight === -1 ? "#e2e2e8" : "#f4f4f7"} stroke="#9a9aa8" strokeWidth={18} pointerEvents="none" />
          )),
        )}

        {layers.furniture && floor.furniture.map((f) => (
          <FurniturePlan key={f.id} f={f} selected={selection?.kind === "furniture" && selection.id === f.id} px={px}
            onPointerDown={(e) => onFurnitureDown(e, f)} movable={editable && tool === "select"} />
        ))}

        {/* Walls */}
        {floor.walls.map((w) =>
          solidSpans(w, floor.openings).map(([s0, s1], i) => (
            <polygon key={`${w.id}-${i}`} points={pts(spanRect(w, s0, s1))}
              fill={selWall?.id === w.id ? BRAND : "#2a2833"}
              style={{ cursor: editable && tool === "select" ? "move" : undefined }}
              data-wall={w.id}
              onPointerDown={(e) => onWallDown(e, w)}
              onPointerMove={(e) => {
                if (tool === "door" || tool === "window") setHover({ wallId: w.id, s: projectOnWall(w, toModel(e.clientX, e.clientY)).s });
              }} />
          )),
        )}

        {/* Openings */}
        {floor.openings.map((o) => {
          const w = walls.get(o.wall);
          if (!w) return null;
          const h = w.thickness / 2;
          const sel = selOpening?.id === o.id;
          return (
            <g key={o.id} onPointerDown={(e) => onOpeningDown(e, o)} style={{ cursor: editable ? "ew-resize" : "pointer" }}>
              <polygon points={pts(spanRect(w, o.offset, o.offset + o.width, -h - 150, h + 150))} fill={sel ? "rgba(106,69,245,0.18)" : "transparent"}
                stroke={sel ? BRAND : "none"} strokeWidth={3 * px} />
              <OpeningSymbol w={w} o={o} h={h} />
            </g>
          );
        })}

        {/* Door/window placement ghost */}
        {editable && (tool === "door" || tool === "window") && hover && walls.get(hover.wallId) && (() => {
          const w = walls.get(hover.wallId)!;
          const width = Math.min((tool === "door" ? 3 : 4) * 304.8, wallLength(w) - 50);
          const offset = Math.min(Math.max(0, hover.s - width / 2), wallLength(w) - width);
          return <polygon points={pts(spanRect(w, offset, offset + width, -w.thickness / 2 - 60, w.thickness / 2 + 60))}
            fill={BRAND} fillOpacity={0.5} pointerEvents="none" />;
        })()}

        {/* Labels */}
        {layers.labels && floor.rooms.map((r) => {
          const b = bbox(r.polygon);
          const [cx, cy] = centroid(r.polygon);
          const small = Math.min(b.w, b.h) < 2400;
          return (
            <g key={r.id} pointerEvents="none" textAnchor="middle">
              <text x={cx} y={-cy - (small ? 60 : 120)} fontSize={small ? 230 : 330} fontWeight={600} fill="#1d1b2e">{r.name}</text>
              <text x={cx} y={-cy + (small ? 220 : 330)} fontSize={small ? 170 : 240} fill="#55546a">{roomSize(r)}</text>
            </g>
          );
        })}

        {layers.dimensions && <Dimensions model={model} />}

        {/* Selected wall: length label + endpoint handles */}
        {editable && selWall && (
          <g>
            <WallLength w={selWall} px={px} />
            {(["a", "b"] as const).map((end) => {
              const [x, y] = P(selWall[end]);
              return (
                <circle key={end} cx={x} cy={y} r={7 * px} fill="#fff" stroke={BRAND} strokeWidth={2.5 * px} style={{ cursor: "grab" }}
                  onPointerDown={(e) => startDrag(e, { kind: "endpoint", wallId: selWall.id, end, original: model, moved: false })} />
              );
            })}
          </g>
        )}

        {/* Selected door/window: drag either end to resize it */}
        {editable && tool === "select" && selOpening && walls.get(selOpening.wall) && (() => {
          const w = walls.get(selOpening.wall)!;
          return (
            <g>
              <WallLength w={{ ...w, a: pointOnWall(w, selOpening.offset), b: pointOnWall(w, selOpening.offset + selOpening.width) }} px={px} />
              {([["start", selOpening.offset], ["end", selOpening.offset + selOpening.width]] as const).map(([end, s]) => {
                const [x, y] = P(pointOnWall(w, s));
                return (
                  <rect key={end} x={x - 5 * px} y={y - 9 * px} width={10 * px} height={18 * px} rx={3 * px} fill="#fff" stroke={BRAND} strokeWidth={2.5 * px}
                    style={{ cursor: "ew-resize" }} transform={`rotate(${-Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180 / Math.PI} ${x} ${y})`}
                    onPointerDown={(e) => startDrag(e, { kind: "opening-end", id: selOpening.id, end, original: model, moved: false })} />
                );
              })}
            </g>
          );
        })()}

        {/* Wall drawing preview */}
        {editable && tool === "wall" && preview && Math.hypot(preview.b[0] - preview.a[0], preview.b[1] - preview.a[1]) > 1 && (
          <g pointerEvents="none">
            <line {...lineProps(preview.a, preview.b)} stroke={BRAND} strokeWidth={115} strokeOpacity={0.45} strokeLinecap="square" />
            <WallLength w={{ id: "preview", a: preview.a, b: preview.b, thickness: 115, type: "interior", assembly: null }} px={px} />
          </g>
        )}
        {editable && tool === "wall" && cursor && (
          <g pointerEvents="none">
            <circle cx={P(cursor.p)[0]} cy={P(cursor.p)[1]} r={5 * px} fill={cursor.snap === "grid" ? "#fff" : BRAND} stroke={BRAND} strokeWidth={2 * px} />
          </g>
        )}

        {/* North arrow */}
        <g transform={`translate(${plot.x1 + PAD * 0.45} ${-plot.y1 - PAD * 0.45}) rotate(${model.north_deg})`} pointerEvents="none">
          <circle r={520} fill="#ffffff" stroke="#3b3a4a" strokeWidth={25} />
          <path d="M0,-430 L190,200 L0,90 L-190,200 Z" fill="#3b3a4a" />
          <text y={-560} textAnchor="middle" fontSize={300} fontWeight={700} fill="#3b3a4a" transform={`rotate(${-model.north_deg} 0 -680)`}>N</text>
        </g>
      </svg>

      {editable && (
        <EditorToolbar
          tool={tool} onTool={(t) => props.onTool?.(t)} history={props.history} onFit={() => setVb(fit())}
          onOuterWalls={floor.walls.length === 0 ? () => props.onEdit?.(addOuterWalls(model), true) : undefined}
        />
      )}
      {editable && <Hint tool={tool} drawing={!!chain} />}
    </div>
  );
}

function EditorToolbar({ tool, onTool, history, onFit, onOuterWalls }: {
  tool: Tool; onTool: (t: Tool) => void; history?: Props["history"]; onFit: () => void; onOuterWalls?: () => void;
}) {
  const tools: { t: Tool; label: string; key: string; icon: ReactNode }[] = [
    { t: "select", label: "Select / move", key: "V", icon: <MousePointer2 size={16} /> },
    { t: "wall", label: "Draw walls", key: "W", icon: <PenLine size={16} /> },
    { t: "door", label: "Add door", key: "D", icon: <DoorOpen size={16} /> },
    { t: "window", label: "Add window", key: "N", icon: <Square size={16} /> },
  ];
  const btn = "grid size-8 place-items-center rounded-lg disabled:opacity-35";
  return (
    <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur">
      {tools.map(({ t, label, key, icon }) => (
        <button key={t} title={`${label} (${key})`} aria-label={label} onClick={() => onTool(t)}
          className={`${btn} ${tool === t ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
          {icon}
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <button title="Undo (Ctrl+Z)" aria-label="Undo" className={`${btn} text-slate-700 hover:bg-slate-100`} disabled={!history?.canUndo} onClick={history?.undo}><Undo2 size={16} /></button>
      <button title="Redo (Ctrl+Y)" aria-label="Redo" className={`${btn} text-slate-700 hover:bg-slate-100`} disabled={!history?.canRedo} onClick={history?.redo}><Redo2 size={16} /></button>
      <button title="Fit plan to view" aria-label="Fit to view" className={`${btn} text-slate-700 hover:bg-slate-100`} onClick={onFit}><Maximize size={16} /></button>
      {onOuterWalls && (
        <button onClick={onOuterWalls} className="ml-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
          + Outer walls on setback line
        </button>
      )}
    </div>
  );
}

function Hint({ tool, drawing }: { tool: Tool; drawing: boolean }) {
  const text = {
    select: "Drag a wall to move it · drag its end handles to resize · drag doors/windows along walls · drag empty space to pan · scroll to zoom",
    wall: drawing ? "Click to place the next corner · click the start point or double-click to finish · Esc to stop · hold Shift for any angle"
      : "Click to start a wall · walls snap to 90°, to other walls and to 3\" steps",
    door: "Click on a wall to add a 3' door",
    window: "Click on a wall to add a 4' window",
  }[tool];
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex justify-center">
      <span className="flex items-center gap-1.5 rounded-lg bg-ink/80 px-3 py-1.5 text-[11px] text-white">
        <Hand size={12} /> {text}
      </span>
    </div>
  );
}

function WallLength({ w, px }: { w: Wall; px: number }) {
  const mid = pointOnWall(w, wallLength(w) / 2, w.thickness / 2 + 14 * px);
  const [x, y] = P(mid);
  const label = ftIn(wallLength(w));
  return (
    <g pointerEvents="none">
      <rect x={x - (label.length * 4 + 6) * px} y={y - 9 * px} width={(label.length * 8 + 12) * px} height={18 * px} rx={5 * px} fill={BRAND} />
      <text x={x} y={y + 4 * px} textAnchor="middle" fontSize={12 * px} fontWeight={700} fill="#fff">{label}</text>
    </g>
  );
}

function Dimensions({ model }: { model: BuildingModel }) {
  const plot = bbox(model.plot.polygon);
  const sb = model.plot.setbacks;
  return (
    <g fill="#3b3a4a" fontSize={300} textAnchor="middle" pointerEvents="none">
      <line x1={plot.x0} x2={plot.x1} y1={-plot.y1 - 900} y2={-plot.y1 - 900} stroke="#3b3a4a" strokeWidth={25} markerStart="url(#arr)" markerEnd="url(#arr)" />
      <text x={plot.cx} y={-plot.y1 - 1050} fontWeight={600}>{ftIn(plot.w)}</text>
      <line x1={plot.x0 - 900} x2={plot.x0 - 900} y1={-plot.y0} y2={-plot.y1} stroke="#3b3a4a" strokeWidth={25} markerStart="url(#arr)" markerEnd="url(#arr)" />
      <text transform={`translate(${plot.x0 - 1050} ${-plot.cy}) rotate(-90)`} fontWeight={600}>{ftIn(plot.h)}</text>
      <text x={plot.cx} y={-(plot.y1 - sb.rear / 2) + 90} fontSize={220}>{ftIn(sb.rear)} Margin</text>
      <text x={plot.cx + 3200} y={-(plot.y0 + sb.front / 2) + 90} fontSize={220}>{ftIn(sb.front)} Margin</text>
      <text transform={`translate(${plot.x0 + sb.left / 2 + 80} ${-plot.cy}) rotate(-90)`} fontSize={220}>{ftIn(sb.left)} Margin</text>
      <text transform={`translate(${plot.x1 - sb.right / 2 + 80} ${-plot.cy}) rotate(90)`} fontSize={220}>{ftIn(sb.right)} Margin</text>
      {model.plot.gate && (
        <g>
          <line x1={model.plot.gate[0] + model.plot.gate[1] / 2} x2={model.plot.gate[0] + model.plot.gate[1] / 2} y1={-plot.y0 + 650} y2={-plot.y0 - 500}
            stroke="#3b3a4a" strokeWidth={30} markerEnd="url(#arr)" />
          <text x={model.plot.gate[0] + model.plot.gate[1] / 2 + 1500} y={-plot.y0 - 150} fontSize={200}>Main Gate {ftIn(model.plot.gate[1])}</text>
        </g>
      )}
    </g>
  );
}

function lineProps(a: Point, b: Point) {
  const [x1, y1] = P(a);
  const [x2, y2] = P(b);
  return { x1, y1, x2, y2 };
}

/** Plan symbol for a door, window, ventilator or opening, by style. */
function OpeningSymbol({ w, o, h }: { w: Wall; o: Opening; h: number }) {
  const s0 = o.offset, s1 = o.offset + o.width, mid = (s0 + s1) / 2;
  const line = (a: number, b: number, k: number, stroke = "#2a2833", width = 20) => (
    <line {...lineProps(pointOnWall(w, a, k), pointOnWall(w, b, k))} stroke={stroke} strokeWidth={width} />
  );
  if (o.kind === "door") {
    if (o.style === "sliding") {
      return <g>{line(s0, mid + 100, -h / 3, "#2a2833", 40)}{line(mid - 100, s1, h / 3, "#2a2833", 40)}</g>;
    }
    if (o.style === "double" || o.style === "french") {
      const half = o.width / 2;
      return (
        <g>
          <DoorSwing w={w} offset={s0} width={half} side={o.side} h={h} />
          <DoorSwing w={w} offset={s1} width={-half} side={o.side} h={h} />
          {o.style === "french" && line(s0, s1, 0, "#4f8fd6", 18)}
        </g>
      );
    }
    return <DoorSwing w={w} offset={s0} width={o.width} side={o.side} h={h} />;
  }
  if (o.kind === "opening") {
    return o.style === "arch" ? <g strokeDasharray="60 50">{line(s0, s1, -h, "#2a2833", 14)}{line(s0, s1, h, "#2a2833", 14)}</g> : null;
  }
  const glass = "#4f8fd6";
  const frame = <polygon points={pts(spanRect(w, s0, s1))} fill="#ffffff" stroke="#2a2833" strokeWidth={20} />;
  if (o.style === "louvered" || o.kind === "ventilator") {
    const n = Math.max(2, Math.round(o.width / 120));
    return <g>{frame}{Array.from({ length: n }, (_, i) => line(s0 + (i + 0.5) * o.width / n - 40, s0 + (i + 0.5) * o.width / n + 40, 0, glass, 16))}</g>;
  }
  if (o.style === "sliding_window") return <g>{frame}{line(s0, mid + 80, -h / 3, glass, 24)}{line(mid - 80, s1, h / 3, glass, 24)}</g>;
  if (o.style === "fixed") return <g>{frame}{line(s0, s1, 0, glass, 45)}</g>;
  const panes = o.style === "three_panel" ? 3 : 2;
  return (
    <g>
      {frame}
      {line(s0, s1, 0, glass, 30)}
      {Array.from({ length: panes - 1 }, (_, i) => {
        const s = s0 + ((i + 1) * o.width) / panes;
        return <line key={i} {...lineProps(pointOnWall(w, s, -h), pointOnWall(w, s, h))} stroke="#2a2833" strokeWidth={16} />;
      })}
    </g>
  );
}

/** One door leaf hinged at `offset`; a negative width hinges at the far jamb and swings back. */
function DoorSwing({ w, offset, width, side, h }: { w: Wall; offset: number; width: number; side: 1 | -1; h: number }) {
  const r = Math.abs(width);
  const H = P(pointOnWall(w, offset, h * side));
  const L = P(pointOnWall(w, offset, (h + r) * side));
  const E = P(pointOnWall(w, offset + width, h * side));
  const cross = (L[0] - H[0]) * (E[1] - H[1]) - (L[1] - H[1]) * (E[0] - H[0]);
  return (
    <g fill="none" stroke="#2a2833">
      <line x1={H[0]} y1={H[1]} x2={L[0]} y2={L[1]} strokeWidth={45} />
      <path d={`M${L[0]},${L[1]} A${r},${r} 0 0 ${cross > 0 ? 1 : 0} ${E[0]},${E[1]}`} strokeWidth={18} strokeDasharray="70 50" />
    </g>
  );
}

function FurniturePlan({ f, selected, px, onPointerDown, movable }: {
  f: Furniture; selected: boolean; px: number; onPointerDown: (e: React.PointerEvent) => void; movable: boolean;
}) {
  const [w, d] = f.size;
  const [x, y] = P(f.pos);
  const box = (bx: number, by: number, bw: number, bd: number, fill = "#ffffff", rx = 60) => (
    <rect x={bx - bw / 2} y={-(by + bd / 2)} width={bw} height={bd} rx={rx} fill={fill} stroke="#8d8a99" strokeWidth={18} />
  );
  const parts: Record<string, ReactNode> = {
    bed_single: <>{box(0, 0, w, d, "#ffffff")}{box(0, d / 2 - 380, w * 0.7, 420, "#eef0f6")}{box(0, -d / 6, w, d * 0.62, "#e4dcf7", 40)}</>,
    bed_double: <>{box(0, 0, w, d, "#ffffff")}{box(-w / 4.4, d / 2 - 380, w / 2.6, 420, "#eef0f6")}{box(w / 4.4, d / 2 - 380, w / 2.6, 420, "#eef0f6")}{box(0, -d / 6, w, d * 0.62, "#e4dcf7", 40)}</>,
    sofa: <>{box(0, 0, w, d, "#e8e1d4")}{box(0, -d / 2 + 160, w, 300, "#d8cfbf")}</>,
    car: <>{box(0, 0, w, d, "#ffffff", 600)}{box(0, d * 0.05, w * 0.78, d * 0.42, "#dfe7f1", 300)}</>,
    dining_table: box(0, 0, w, d, "#efe2cc", 120),
    chair: box(0, 0, w, d, "#ffffff", 120),
    wc: <>{box(0, 0, w, d, "#ffffff", 200)}{box(0, d / 2 - 150, w, 260, "#eef0f6", 40)}</>,
  };
  return (
    <g transform={`translate(${x} ${y}) rotate(${-f.rot})`} onPointerDown={onPointerDown} style={{ cursor: movable ? "move" : "pointer" }}>
      {parts[f.type] ?? box(0, 0, w, d, "#f2f0f6", 30)}
      {selected && (
        <rect x={-w / 2 - 4 * px} y={-d / 2 - 4 * px} width={w + 8 * px} height={d + 8 * px} rx={4 * px}
          fill="rgba(106,69,245,0.08)" stroke={BRAND} strokeWidth={2.5 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
      )}
    </g>
  );
}
