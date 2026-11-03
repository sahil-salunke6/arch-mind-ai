import { useEffect, useMemo, useState } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { ArrowLeft, Layers3 } from "lucide-react";
import type { BuildingModel, Opening, Room, Wall } from "../types";
import { bbox, ftIn, wallLength } from "../lib/geometry";
import { chosen, PARTS, setSpec, type MaterialOption, type Scope } from "../lib/materials";
import { openingLabel } from "../lib/edit";

const M = 1 / 1000;

export type CloseUpTarget =
  | { kind: "wall"; id: string }
  | { kind: "floor"; roomId: string }
  | { kind: "roof" }
  | { kind: "opening"; id: string };

/** What is selected inside the close-up: a part type, plus an optional instance description. */
interface Pick {
  part: string;
  scope: Scope;
  detail?: [string, string][]; // facts about the clicked piece (e.g. which brick)
  title?: string;
}

interface Props {
  model: BuildingModel;
  target: CloseUpTarget;
  onEdit: (next: BuildingModel) => void;
  onClose: () => void;
}

export default function CloseUp({ model, target, onEdit, onClose }: Props) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [explode, setExplode] = useState(false);
  const floor = model.floors[0];
  const wall = target.kind === "wall" ? floor.walls.find((w) => w.id === target.id) : undefined;
  const room = target.kind === "floor" ? floor.rooms.find((r) => r.id === target.roomId) : undefined;
  const opening = target.kind === "opening" ? floor.openings.find((o) => o.id === target.id) : undefined;

  const title = wall ? `${wall.type === "exterior" ? "External" : "Internal"} wall ${wall.id} · ${ftIn(wallLength(wall))} long`
    : room ? `Floor of ${room.name}` : opening ? `${openingLabel(opening)} ${ftIn(opening.width)} × ${ftIn(opening.height)}` : "Roof slab";

  const legend = wall ? wallLegend(model, wall) : room ? floorLegend(model, room) : opening ? openingLegend(model, opening) : roofLegend(model);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white md:flex-row">
      <div className="relative min-h-[320px] flex-1">
        <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
          <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-semibold shadow-sm hover:bg-slate-50">
            <ArrowLeft size={14} /> Back to house
          </button>
          <span className="rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-slate-700 shadow-sm">{title}</span>
        </div>
        <label className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-lg bg-white/95 px-2 py-1 text-[11px] font-medium shadow-sm">
          <input type="checkbox" checked={explode} onChange={(e) => setExplode(e.target.checked)} className="accent-brand-600" /> Separate layers
        </label>
        <p className="pointer-events-none absolute right-2 bottom-2 left-2 text-center text-[11px] text-slate-500">
          Drag to turn · scroll to zoom · right-drag to move · click any part for its details
        </p>
        <Canvas shadows camera={{ position: [1.9, 1.7, 2.6], fov: 40 }} onPointerMissed={() => setPick(null)}
          style={{ background: "linear-gradient(#f4f5f9, #e9ebf1)" }}>
          <hemisphereLight args={["#ffffff", "#c9ccd4", 1.2]} />
          <directionalLight castShadow position={[3, 5, 4]} intensity={2} />
          <OrbitControls makeDefault target={[0, wall ? 1.5 : 0.3, 0]} enableDamping />
          {wall && <WallSample model={model} wall={wall} explode={explode} pick={pick} onPick={setPick} />}
          {room && <FloorSample model={model} room={room} explode={explode} pick={pick} onPick={setPick} />}
          {target.kind === "roof" && <RoofSample model={model} explode={explode} pick={pick} onPick={setPick} />}
          {opening && <OpeningSample model={model} opening={opening} pick={pick} onPick={setPick} />}
          <gridHelper args={[6, 12, "#c7cad3", "#dde0e6"]} position={[0, -0.001, 0]} />
        </Canvas>
      </div>
      <PartPanel model={model} pick={pick} legend={legend} summary={wall ? wallSummary(model, wall) : null} onPick={setPick} onEdit={onEdit} />
    </div>
  );
}

// --- the right-hand panel ----------------------------------------------------------------------

function PartPanel({ model, pick, legend, summary, onPick, onEdit }: {
  model: BuildingModel; pick: Pick | null; legend: Pick[]; summary: string | null; onPick: (p: Pick | null) => void; onEdit: (m: BuildingModel) => void;
}) {
  if (!pick) {
    return (
      <aside className="w-full shrink-0 overflow-y-auto border-t border-slate-100 p-3 md:w-72 md:border-t-0 md:border-l">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Layers3 size={15} /> Build-up</h3>
        {summary && <p className="mb-2 text-xs text-slate-500">{summary}</p>}
        <ul className="space-y-1">
          {legend.map((l) => {
            const opt = chosen(model, l.scope, l.part);
            return (
              <li key={l.part}>
                <button onClick={() => onPick(l)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span className="size-4 shrink-0 rounded border border-black/10" style={{ background: opt.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-slate-500">{PARTS[l.part].name}</span>
                    <span className="block truncate font-medium">{opt.name}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Click a part in the picture or in this list to see its details and change it.</p>
      </aside>
    );
  }
  const part = PARTS[pick.part];
  const current = chosen(model, pick.scope, pick.part);
  const applies = pick.scope.kind === "wall" ? `all ${pick.scope.wallType} walls` : pick.scope.kind === "room" ? "this room" : pick.scope.kind === "roof" ? "the whole roof" : "this opening";
  return (
    <aside className="w-full shrink-0 overflow-y-auto border-t border-slate-100 p-3 md:w-72 md:border-t-0 md:border-l">
      <button onClick={() => onPick(null)} className="mb-2 text-xs text-brand-700 hover:underline">← All layers</button>
      <h3 className="text-sm font-semibold">{pick.title ?? part.name}</h3>
      <p className="mb-2 text-xs text-slate-500">{current.name}: {current.summary}</p>
      {pick.detail && <Table rows={pick.detail} />}
      <Table rows={current.props} />
      <h4 className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Options · applies to {applies}</h4>
      <ul className="space-y-1.5">
        {part.options.map((o) => (
          <li key={o.id}>
            <OptionCard option={o} active={o.id === current.id} onClick={() => onEdit(setSpec(model, pick.scope, pick.part, o.id))} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[10px] leading-4 text-slate-400">Typical values for guidance only; confirm with supplier data sheets and your engineer.</p>
    </aside>
  );
}

function OptionCard({ option, active, onClick }: { option: MaterialOption; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left ${active ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-300"}`}>
      <span className="mt-0.5 size-5 shrink-0 rounded border border-black/10" style={{ background: option.color }} />
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{option.name}</span>
        <span className="block text-[11px] leading-4 text-slate-500">{option.summary}</span>
      </span>
    </button>
  );
}

function Table({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-100 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2 px-2 py-1.5">
          <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
          <dd className="min-w-0 flex-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- legends: which parts each element is made of ---------------------------------------------

/** "230 mm = 18 + 200 + 12 mm": how the wall thickness is made up. */
function wallSummary(model: BuildingModel, wall: Wall): string {
  const s = wallScope(wall);
  const tOut = chosen(model, s, wall.type === "exterior" ? "plaster_ext" : "plaster_int").thickness ?? 18;
  const tIn = chosen(model, s, "plaster_int").thickness ?? 12;
  const core = Math.max(60, wall.thickness - tOut - tIn);
  return `${Math.round(wall.thickness)} mm thick = ${tOut} mm plaster + ${Math.round(core)} mm ${chosen(model, s, "masonry").name.toLowerCase()} + ${tIn} mm plaster`;
}

function wallScope(wall: Wall): Scope {
  return { kind: "wall", wallType: wall.type };
}

function wallLegend(model: BuildingModel, wall: Wall): Pick[] {
  const s = wallScope(wall);
  const outer = wall.type === "exterior";
  const parts = [outer ? "paint_ext" : "paint_int", outer ? "plaster_ext" : "plaster_int", "masonry", "mortar", "plaster_int", "paint_int", "conduit"];
  if (wallHasWater(model, wall)) parts.push("pipe");
  if (model.floors[0].openings.some((o) => o.wall === wall.id)) parts.push("lintel");
  parts.push("dpc");
  return [...new Set(parts)].map((part) => ({ part, scope: s }));
}

function floorLegend(_model: BuildingModel, room: Room): Pick[] {
  const s: Scope = { kind: "room", roomId: room.id };
  return ["floor_finish", "floor_bed", "sub_base"].map((part) => ({ part, scope: s }));
}

function roofLegend(_model: BuildingModel): Pick[] {
  return ["waterproofing", "slab", "plaster_int", "paint_int"].map((part) => ({ part, scope: part.startsWith("p") ? { kind: "wall", wallType: "interior" } as Scope : { kind: "roof" } as Scope }));
}

function openingLegend(_model: BuildingModel, o: Opening): Pick[] {
  const s: Scope = { kind: "opening", openingId: o.id };
  return o.kind === "door" ? (o.style === "sliding" || o.style === "french" ? ["door_frame", "glass"] : ["door_frame", "door_shutter"]).map((part) => ({ part, scope: s }))
    : o.kind === "opening" ? [{ part: "lintel", scope: s }] : ["window_frame", "glass", "lintel"].map((part) => ({ part, scope: s }));
}

/** Toilet and kitchen walls carry water pipes. */
function wallHasWater(model: BuildingModel, wall: Wall): boolean {
  const wet = model.floors[0].rooms.filter((r) => r.type === "toilet" || r.type === "kitchen");
  return wet.some((r) => {
    const b = bbox(r.polygon);
    const mx = (wall.a[0] + wall.b[0]) / 2, my = (wall.a[1] + wall.b[1]) / 2;
    const pad = wall.thickness;
    return mx >= b.x0 - pad && mx <= b.x1 + pad && my >= b.y0 - pad && my <= b.y1 + pad;
  });
}

// --- shared 3D helpers -------------------------------------------------------------------------

interface SampleProps {
  model: BuildingModel;
  explode: boolean;
  pick: Pick | null;
  onPick: (p: Pick) => void;
}

/** A box in mm, positioned by its min corner (x along the sample, y up, z through the wall). */
function Slab({ x, y, z, w, h, d, color, selected, onClick, opacity = 1 }: {
  x: number; y: number; z: number; w: number; h: number; d: number; color: string; selected?: boolean;
  onClick?: (e: ThreeEvent<MouseEvent>) => void; opacity?: number;
}) {
  return (
    <mesh position={[(x + w / 2) * M, (y + h / 2) * M, (z + d / 2) * M]} castShadow receiveShadow
      onClick={onClick && ((e) => { e.stopPropagation(); onClick(e); })}>
      <boxGeometry args={[w * M, h * M, d * M]} />
      <meshStandardMaterial color={selected ? "#8b6cff" : color} roughness={0.85} transparent={opacity < 1} opacity={opacity}
        emissive={selected ? "#3b1fd1" : "#000000"} emissiveIntensity={selected ? 0.25 : 0} />
    </mesh>
  );
}

function Rod({ from, to, r, color, selected, onClick }: {
  from: [number, number, number]; to: [number, number, number]; r: number; color: string; selected?: boolean; onClick?: () => void;
}) {
  const a = new THREE.Vector3(...from).multiplyScalar(M), b = new THREE.Vector3(...to).multiplyScalar(M);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return (
    <mesh position={mid} quaternion={q} castShadow onClick={onClick && ((e) => { e.stopPropagation(); onClick(); })}>
      <cylinderGeometry args={[r * M, r * M, len, 16]} />
      <meshStandardMaterial color={selected ? "#8b6cff" : color} roughness={0.5} metalness={color === "#6b6f75" ? 0.6 : 0} />
    </mesh>
  );
}

// --- wall sample -------------------------------------------------------------------------------

function WallSample({ model, wall, explode, pick, onPick }: SampleProps & { wall: Wall }) {
  const floor = model.floors[0];
  const s = wallScope(wall);
  const outer = wall.type === "exterior";
  const W = Math.min(1200, Math.max(600, wallLength(wall)));
  const H = floor.height;
  const T = wall.thickness;
  const gap = explode ? 70 : 0;
  const masonry = chosen(model, s, "masonry");
  const mortar = chosen(model, s, "mortar", { wallType: wall.type });
  const pOut = chosen(model, s, outer ? "plaster_ext" : "plaster_int");
  const pIn = chosen(model, s, "plaster_int");
  const paintOut = chosen(model, s, outer ? "paint_ext" : "paint_int");
  const paintIn = chosen(model, s, "paint_int");
  const tOut = pOut.thickness ?? 18, tIn = pIn.thickness ?? 12;
  const core = Math.max(60, T - tOut - tIn);
  const is = (part: string) => pick?.part === part && !pick.detail;
  const hasOpening = floor.openings.some((o) => o.wall === wall.id);
  const water = wallHasWater(model, wall);

  // z layout (through the wall, outside at -z): paint | plaster | core | plaster | paint
  const zCore = 0, zOut = -tOut - gap, zIn = core + gap;
  const plinth = 450;

  const bricks = useMemo(() => brickLayout(masonry, mortar.thickness ?? 10, W, H, core), [masonry, mortar, W, H, core]);
  const pickBrick = (i: number) => {
    const b = bricks[i];
    onPick({
      part: "masonry", scope: s, title: `${masonry.name} · course ${b.course + 1}`,
      detail: [["This piece", `${Math.round(b.w)} × ${Math.round(b.d)} × ${Math.round(b.h)} mm${b.cut ? " (cut to fit)" : ""}`],
        ["Position", `${b.course + 1}${ordinal(b.course + 1)} course, ${(b.y / 1000).toFixed(2)} m above floor`],
        ["Courses in this wall", `${Math.max(...bricks.map((x) => x.course)) + 1} in ${ftIn(H)}`]],
    });
  };

  return (
    <group position={[-W / 2 * M, plinth * M, -T / 2 * M]}>
      {/* plinth, DPC */}
      <Slab x={-50} y={-plinth} z={-tOut - 50} w={W + 100} h={plinth - 40} d={T + 100} color="#bdb6aa"
        onClick={() => onPick({ part: "dpc", scope: s, title: "Plinth & damp-proof course" })} selected={is("dpc")} />
      <Slab x={-30} y={-40} z={-tOut - 30} w={W + 60} h={40} d={T + 60} color={chosen(model, s, "dpc").color}
        onClick={() => onPick({ part: "dpc", scope: s })} selected={is("dpc")} />

      {/* mortar fills the core; bricks sit in it leaving the joints visible */}
      <Slab x={0} y={0} z={zCore} w={W} h={H} d={core} color={mortar.color}
        onClick={() => onPick({ part: "mortar", scope: s })} selected={is("mortar")} />
      <Bricks bricks={bricks} color={masonry.color} z={zCore} selectedPart={pick?.part === "masonry"} onPick={pickBrick} />

      {/* outside finish peeled back so the bricks show (like a cutaway drawing) */}
      <Slab x={W * 0.38} y={0} z={zOut} w={W * 0.62} h={H} d={tOut} color={pOut.color}
        onClick={() => onPick({ part: outer ? "plaster_ext" : "plaster_int", scope: s })} selected={is(outer ? "plaster_ext" : "plaster_int")} />
      <Slab x={W * 0.62} y={0} z={zOut - 3 - gap / 2} w={W * 0.38} h={H} d={3} color={paintOut.color}
        onClick={() => onPick({ part: outer ? "paint_ext" : "paint_int", scope: s })} selected={is(outer ? "paint_ext" : "paint_int")} />
      {/* inside finish */}
      <Slab x={W * 0.25} y={0} z={zIn} w={W * 0.75} h={H} d={tIn} color={pIn.color}
        onClick={() => onPick({ part: "plaster_int", scope: s })} selected={is("plaster_int")} />
      <Slab x={W * 0.5} y={0} z={zIn + tIn + gap / 2} w={W * 0.5} h={H} d={3} color={paintIn.color}
        onClick={() => onPick({ part: "paint_int", scope: s })} selected={is("paint_int")} />

      {/* services chased into the inside face */}
      <Rod from={[W * 0.16, 0, core - 22]} to={[W * 0.16, H, core - 22]} r={10} color="#f4f4f4" selected={pick?.part === "conduit"}
        onClick={() => onPick({ part: "conduit", scope: s, title: "Electrical conduit & switch box" })} />
      <Slab x={W * 0.16 - 100} y={1150} z={core - 55} w={200} h={100} d={60} color="#c9ccd1" selected={pick?.part === "conduit"}
        onClick={() => onPick({ part: "conduit", scope: s, title: "Switch box (concealed, 1.2 m)", detail: [["Height", "1.2 m (4 ft) above floor"], ["Box", "GI, 6-module"]] })} />
      {water && (
        <Rod from={[0, 900, core - 30]} to={[W, 900, core - 30]} r={12} color={chosen(model, s, "pipe").color} selected={pick?.part === "pipe"}
          onClick={() => onPick({ part: "pipe", scope: s, title: "Water supply pipe", detail: [["Height", "≈ 0.9 m, to taps and mixer"]] })} />
      )}

      {/* RCC lintel with its bars where the wall has doors/windows */}
      {hasOpening && (
        <group>
          <Slab x={0} y={2134} z={zCore} w={W} h={150} d={core} color={chosen(model, s, "lintel").color} opacity={0.92}
            onClick={() => onPick({ part: "lintel", scope: s })} selected={is("lintel")} />
          {[[30, 30], [core - 30, 30], [30, 120], [core - 30, 120]].map(([z, y], i) => (
            <Rod key={i} from={[-20, 2134 + y, z]} to={[W + 20, 2134 + y, z]} r={i < 2 ? 5 : 4} color="#6b6f75"
              selected={pick?.part === "lintel"} onClick={() => onPick({ part: "lintel", scope: s, title: "Lintel reinforcement" })} />
          ))}
        </group>
      )}

    </group>
  );
}

interface BrickInstance { x: number; y: number; w: number; h: number; d: number; z: number; course: number; cut: boolean }

/** Stretcher bond, half-unit offset each course, as many leaves as fit the core. */
function brickLayout(m: MaterialOption, joint: number, W: number, H: number, core: number): BrickInstance[] {
  const [l, h, w] = m.unit ?? [230, 75, 110];
  const leaves = Math.max(1, Math.round((core + joint) / (w + joint)));
  const leafW = (core - joint * (leaves - 1)) / leaves;
  const out: BrickInstance[] = [];
  const courses = Math.floor(H / (h + joint));
  for (let c = 0; c < courses; c++) {
    const y = c * (h + joint) + joint / 2;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const offset = ((c + leaf) % 2) * (l + joint) / 2;
      for (let x = -offset; x < W; x += l + joint) {
        const x0 = Math.max(0, x), x1 = Math.min(W, x + l);
        if (x1 - x0 < 20) continue;
        out.push({ x: x0, y, w: x1 - x0, h, d: leafW, z: leaf * (leafW + joint), course: c, cut: x1 - x0 < l - 1 });
      }
    }
  }
  return out;
}

function Bricks({ bricks, color, z, selectedPart, onPick }: {
  bricks: BrickInstance[]; color: string; z: number; selectedPart: boolean; onPick: (i: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const im = new THREE.InstancedMesh(geo, mat, bricks.length);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color(color);
    bricks.forEach((b, i) => {
      m4.makeScale(b.w * M, b.h * M, b.d * M).setPosition((b.x + b.w / 2) * M, (b.y + b.h / 2) * M, (z + b.z + b.d / 2) * M);
      im.setMatrixAt(i, m4);
      // slight colour variation, like real bricks
      im.setColorAt(i, c.clone().offsetHSL(0, 0, ((i * 7919) % 13) / 260 - 0.025));
    });
    im.castShadow = im.receiveShadow = true;
    return im;
  }, [bricks, color, z]);
  const tint = (i: number | null, col: string | null) => {
    if (i === null) return;
    mesh.setColorAt(i, new THREE.Color(col ?? color).offsetHSL(0, 0, col ? 0 : ((i * 7919) % 13) / 260 - 0.025));
    mesh.instanceColor!.needsUpdate = true;
  };
  useEffect(() => {
    if (!selectedPart && picked !== null) { tint(picked, null); setPicked(null); }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <primitive object={mesh}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (e.instanceId !== hover) { if (hover !== picked) tint(hover, null); if (e.instanceId !== picked) tint(e.instanceId ?? null, "#d98a62"); setHover(e.instanceId ?? null); } }}
      onPointerOut={() => { if (hover !== picked) tint(hover, null); setHover(null); }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.instanceId === undefined) return;
        tint(picked, null);
        tint(e.instanceId, "#8b6cff");
        setPicked(e.instanceId);
        onPick(e.instanceId);
      }} />
  );
}

function ordinal(n: number) {
  return n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
}

// --- floor sample ------------------------------------------------------------------------------

function FloorSample({ model, room, explode, pick, onPick }: SampleProps & { room: Room }) {
  const s: Scope = { kind: "room", roomId: room.id };
  const ctx = { roomType: room.type };
  const finish = chosen(model, s, "floor_finish", ctx);
  const bed = chosen(model, s, "floor_bed");
  const base = chosen(model, s, "sub_base");
  const S = 1800;
  const gap = explode ? 80 : 0;
  const tFinish = finish.thickness ?? 10, tBed = bed.thickness ?? 30, tBase = base.thickness ?? 100;
  const tile = finish.id === "gvt" ? [800, 1600] : finish.id === "anti_skid" ? [300, 300] : ["marble", "granite", "kota", "laminate"].includes(finish.id) ? [600, 1200] : [600, 600];
  const tiles = [];
  for (let x = 0; x < S; x += tile[0] + 2) for (let z = 0; z < S; z += tile[1] + 2) {
    tiles.push({ x, z, w: Math.min(tile[0], S - x), d: Math.min(tile[1], S - z) });
  }
  const y0 = 200;
  return (
    <group position={[-S / 2 * M, 0, -S / 2 * M]}>
      <Slab x={0} y={0} z={0} w={S} h={y0} d={S} color="#a88f6c" onClick={() => onPick({ part: "sub_base", scope: s, title: "Earth / sand filling", detail: [["Compaction", "Rammed in 150 mm layers, watered"]] })} />
      <Slab x={0} y={y0 + gap * 0} z={0} w={S} h={tBase} d={S} color={base.color} selected={pick?.part === "sub_base"} onClick={() => onPick({ part: "sub_base", scope: s })} />
      <Slab x={0} y={y0 + tBase + gap} z={0} w={S} h={tBed} d={S} color={bed.color} selected={pick?.part === "floor_bed"} onClick={() => onPick({ part: "floor_bed", scope: s })} />
      {tiles.map((t, i) => (
        <Slab key={i} x={t.x} y={y0 + tBase + tBed + gap * 2} z={t.z} w={t.w} h={tFinish} d={t.d}
          color={i % 2 && finish.id !== "laminate" ? finish.color : shade(finish.color, -0.03)} selected={pick?.part === "floor_finish"}
          onClick={() => onPick({ part: "floor_finish", scope: s, title: `${finish.name} · one piece`, detail: [["This piece", `${Math.round(t.w)} × ${Math.round(t.d)} × ${tFinish} mm`], ["Room area", `${Math.round(Math.abs(areaOf(room)) / 92903)} sq ft`]] })} />
      ))}
    </group>
  );
}

function areaOf(room: Room) {
  let a = 0;
  room.polygon.forEach(([x0, y0], i) => { const [x1, y1] = room.polygon[(i + 1) % room.polygon.length]; a += x0 * y1 - x1 * y0; });
  return a / 2;
}

function shade(hex: string, l: number) {
  return "#" + new THREE.Color(hex).offsetHSL(0, 0, l).getHexString();
}

// --- roof sample -------------------------------------------------------------------------------

function RoofSample({ model, explode, pick, onPick }: SampleProps) {
  const s: Scope = { kind: "roof" };
  const slab = chosen(model, s, "slab");
  const wp = chosen(model, s, "waterproofing");
  const ceiling = chosen(model, { kind: "wall", wallType: "interior" }, "plaster_int");
  const S = 1800, T = slab.thickness ?? 125, gap = explode ? 90 : 0, tw = wp.thickness ?? 4;
  const bars = [];
  for (let x = 75; x < S; x += 150) bars.push(x);
  return (
    <group position={[-S / 2 * M, 0.6, -S / 2 * M]}>
      <Slab x={0} y={-12 - gap} z={0} w={S} h={12} d={S} color={ceiling.color} selected={pick?.part === "plaster_int"}
        onClick={() => onPick({ part: "plaster_int", scope: { kind: "wall", wallType: "interior" }, title: "Ceiling plaster" })} />
      <Slab x={0} y={0} z={0} w={S} h={T} d={S} color={slab.color} opacity={0.55} selected={pick?.part === "slab"} onClick={() => onPick({ part: "slab", scope: s })} />
      {bars.map((x) => <Rod key={`x${x}`} from={[x, 25, 0]} to={[x, 25, S]} r={5} color="#6b6f75" selected={pick?.part === "slab"} onClick={() => onPick({ part: "slab", scope: s, title: "Slab reinforcement", detail: [["Bars", "10 mm Fe500 at 150 mm, both ways"], ["Cover", "20 mm"]] })} />)}
      {bars.map((z) => <Rod key={`z${z}`} from={[0, 35, z]} to={[S, 35, z]} r={5} color="#6b6f75" selected={pick?.part === "slab"} onClick={() => onPick({ part: "slab", scope: s, title: "Slab reinforcement" })} />)}
      <Slab x={0} y={T + gap} z={0} w={S} h={tw} d={S} color={wp.color} selected={pick?.part === "waterproofing"} onClick={() => onPick({ part: "waterproofing", scope: s })} />
      <Slab x={0} y={T + tw + gap} z={-115} w={S} h={model.roof.parapet} d={115} color="#efece6"
        onClick={() => onPick({ part: "masonry", scope: { kind: "wall", wallType: "interior" }, title: "Parapet wall (half brick)" })} />
    </group>
  );
}

// --- door / window sample ----------------------------------------------------------------------

function OpeningSample({ model, opening: o, pick, onPick }: { model: BuildingModel; opening: Opening; pick: Pick | null; onPick: (p: Pick) => void }) {
  const s: Scope = { kind: "opening", openingId: o.id };
  const door = o.kind === "door";
  const frame = chosen(model, s, door ? "door_frame" : "window_frame");
  const glass = chosen(model, s, "glass");
  const shutter = chosen(model, s, "door_shutter");
  const glazed = !door || o.style === "sliding" || o.style === "french";
  const W = o.width, H = o.height, F = 65;
  const leaves = o.style === "double" || o.style === "french" || o.style === "sliding" || o.style === "sliding_window" ? 2 : o.style === "three_panel" ? 3 : 1;
  const pickFrame = () => onPick({ part: door ? "door_frame" : "window_frame", scope: s, detail: [["Opening", `${ftIn(W)} × ${ftIn(H)}`], ["Sill", o.sill ? ftIn(o.sill) : "none"]] });
  return (
    <group position={[-W / 2 * M, (door ? 0 : 0.3), 0]}>
      <Slab x={-F} y={0} z={0} w={F} h={H} d={100} color={frame.color} selected={pick?.part?.endsWith("frame")} onClick={pickFrame} />
      <Slab x={W} y={0} z={0} w={F} h={H} d={100} color={frame.color} selected={pick?.part?.endsWith("frame")} onClick={pickFrame} />
      <Slab x={-F} y={H} z={0} w={W + 2 * F} h={F} d={100} color={frame.color} selected={pick?.part?.endsWith("frame")} onClick={pickFrame} />
      {!door && <Slab x={-F} y={-F} z={0} w={W + 2 * F} h={F} d={100} color={frame.color} selected={pick?.part?.endsWith("frame")} onClick={pickFrame} />}
      {Array.from({ length: leaves }, (_, i) => {
        const lw = W / leaves;
        return glazed ? (
          <group key={i}>
            <Slab x={i * lw + 25} y={25} z={40} w={lw - 50} h={H - 50} d={8} color={glass.color} opacity={0.5}
              selected={pick?.part === "glass"} onClick={() => onPick({ part: "glass", scope: s, detail: [["This pane", `${Math.round(lw - 50)} × ${Math.round(H - 50)} mm`]] })} />
            <Slab x={i * lw} y={0} z={35} w={25} h={H} d={20} color={frame.color} />
            <Slab x={(i + 1) * lw - 25} y={0} z={35} w={25} h={H} d={20} color={frame.color} />
          </group>
        ) : (
          <Slab key={i} x={i * lw + 3} y={3} z={30} w={lw - 6} h={H - 6} d={35} color={shutter.color}
            selected={pick?.part === "door_shutter"} onClick={() => onPick({ part: "door_shutter", scope: s, detail: [["This leaf", `${Math.round(lw - 6)} × ${Math.round(H - 6)} × 35 mm`]] })} />
        );
      })}
    </group>
  );
}
