import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle, BedDouble, Building2, Car, CheckCircle2, Compass, FilePlus2, Frame, ImagePlus, Info, Layers, Loader2, Ruler, ShowerHead,
  Pencil, RotateCcw, RotateCw, Sparkles, SquareDashed, Trash2,
} from "lucide-react";
import type { ProjectInfo, SketchReport } from "../lib/api";
import type { CloseUpTarget } from "./CloseUp";
import type { BuildingModel, Layers as LayerState, Opening, RoomType, Selection, Side } from "../types";
import { centroid, ftIn, polygonArea, roomSize, sqft, summary, wallLength } from "../lib/geometry";
import {
  addFurniture, applyPreset, deleteFurniture, deleteOpening, deleteWall, FURNITURE, OPENING_PRESETS, openingLabel, rotateFurniture,
  setPlotSize, setRoadSide, setWallLength, setWallType, updateOpening, updateRoom, type OpeningPreset,
} from "../lib/edit";
import { parseLength, parseSize } from "../lib/units";

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`flex-1 border-b-2 px-2 py-3 text-sm font-semibold ${
            value === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export interface Upload {
  name: string;
  url: string;
  file: File;
}

export function LeftPanel(props: {
  upload: Upload | null;
  onUpload: (f: File) => void;
  onClear: () => void;
  prompt: string;
  onPrompt: (s: string) => void;
  onGenerate: () => void;
  notice: string | null;
  projects: ProjectInfo[];
  current: string | null;
  onOpen: (id: string) => void;
  onNew: (kind: "blank" | "sample") => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  reading: boolean;
  report: SketchReport | null;
}) {
  const [tab, setTab] = useState<"Input" | "Projects">("Input");
  return (
    <aside className="flex flex-col rounded-2xl border border-black/5 bg-white shadow-sm">
      <Tabs tabs={["Input", "Projects"]} value={tab} onChange={setTab} />
      {tab === "Input" ? (
        <div className="flex flex-1 flex-col gap-4 p-4">
          <h2 className="font-semibold">Create from Hand Drawing</h2>
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-brand-500 hover:bg-brand-50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) props.onUpload(f); }}
          >
            <ImagePlus size={34} className="text-brand-600" />
            <span className="text-sm font-semibold">Upload Hand-Drawn Plan</span>
            <span className="text-xs text-slate-500">JPG, PNG (max 50 MB)</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && props.onUpload(e.target.files[0])} />
          </label>
          {props.upload && (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <img src={props.upload.url} alt="" className="h-32 w-full bg-slate-50 object-contain" />
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate">{props.upload.name}</span>
                <button onClick={props.onClear} className="text-slate-500 hover:text-red-600" aria-label="Remove upload">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Describe Your Requirements</h3>
            <textarea
              value={props.prompt}
              onChange={(e) => props.onPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. 3BHK on a 40x60 east-facing plot with car parking and a puja room"
              className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-brand-500"
            />
          </div>
          {props.notice && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <Info size={15} className="mt-0.5 shrink-0" /> {props.notice}
            </p>
          )}
          {props.report && <ReadReport report={props.report} />}
          <button
            onClick={props.onGenerate}
            disabled={props.reading}
            className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 py-3 font-semibold text-white shadow-md shadow-brand-500/30 hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
          >
            {props.reading ? <><Loader2 size={17} className="animate-spin" /> Reading your sketch…</> : <>Generate Design <Sparkles size={17} /></>}
          </button>
          {!props.upload && !props.report && (
            <p className="text-[11px] leading-4 text-slate-500">
              Tips: plain paper, dark pen, whole page in the photo, and write the size of every room (12&apos; x 14&apos;) and of the plot.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => props.onNew("blank")} className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2 py-2 text-xs font-semibold text-white hover:bg-brand-700">
              <FilePlus2 size={14} /> Blank plot
            </button>
            <button onClick={() => props.onNew("sample")} className="rounded-lg border border-brand-200 px-2 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">
              Copy of sample
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {props.projects.map((p) => (
              <ProjectRow key={p.id} project={p} current={p.id === props.current}
                onOpen={() => props.onOpen(p.id)} onRename={(n) => props.onRename(p.id, n)} onDelete={() => props.onDelete(p.id)} />
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

/** Pick a door/window type; the current one is highlighted. Sizes stay editable below. */
function PresetPicker({ opening, onPick }: { opening: Opening; onPick: (p: OpeningPreset) => void }) {
  const doorLike = opening.kind === "door" || opening.kind === "opening";
  const groups = [
    { title: "Doors", items: OPENING_PRESETS.filter((p) => p.kind === "door" || p.kind === "opening") },
    { title: "Windows", items: OPENING_PRESETS.filter((p) => p.kind === "window" || p.kind === "ventilator") },
  ];
  const ft = 304.8;
  const isCurrent = (p: OpeningPreset) =>
    p.kind === opening.kind && (p.style === (opening.style || (opening.kind === "door" ? "single" : opening.kind === "window" ? "casement" : p.style)))
    && Math.abs(p.size[0] * ft - opening.width) < 40;
  return (
    <div className="space-y-3">
      {(doorLike ? groups : [...groups].reverse()).map((g) => (
        <div key={g.title}>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{g.title}</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((p) => (
              <button key={p.id} onClick={() => onPick(p)} title={`${p.label}: ${p.use}`}
                className={`flex items-center gap-2 rounded-lg border p-1.5 text-left ${isCurrent(p) ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-300"}`}>
                <PresetIcon style={p.style} kind={p.kind} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{p.label}</span>
                  <span className="block truncate text-[10px] text-slate-500">{p.size[0]}&apos; × {p.size[1]}&apos; · {p.use}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Small plan symbol: wall in grey, the door/window in ink. */
function PresetIcon({ style, kind }: { style: string; kind: string }) {
  const ink = "#1d1b2e", glass = "#4f8fd6";
  const wall = <><rect x="0" y="17" width="6" height="6" fill="#9ca3af" /><rect x="34" y="17" width="6" height="6" fill="#9ca3af" /></>;
  let body;
  if (kind === "door" && style === "double") body = <><path d="M6 20 V4 M34 20 V4" stroke={ink} strokeWidth="2" /><path d="M6 4 A14 14 0 0 1 20 20 M34 4 A14 14 0 0 0 20 20" stroke={ink} fill="none" strokeDasharray="2 2" /></>;
  else if (kind === "door" && style === "french") body = <><path d="M6 20 V4 M34 20 V4" stroke={glass} strokeWidth="2.5" /><path d="M6 4 A14 14 0 0 1 20 20 M34 4 A14 14 0 0 0 20 20" stroke={ink} fill="none" strokeDasharray="2 2" /></>;
  else if (kind === "door" && style === "sliding") body = <><path d="M6 18 H23 M17 22 H34" stroke={ink} strokeWidth="2.5" /><path d="M24 10 h8 m-3 -3 l3 3 l-3 3" stroke={ink} fill="none" /></>;
  else if (kind === "door") body = <><path d="M6 20 V0" stroke={ink} strokeWidth="2" /><path d="M6 0 A20 20 0 0 1 26 20" stroke={ink} fill="none" strokeDasharray="2 2" /></>;
  else if (kind === "opening") body = <path d="M6 17 H34 M6 23 H34" stroke={ink} strokeDasharray="3 2" />;
  else if (style === "fixed") body = <><rect x="6" y="17" width="28" height="6" fill="#fff" stroke={ink} /><path d="M6 20 H34" stroke={glass} strokeWidth="3" /></>;
  else if (style === "sliding_window") body = <><rect x="6" y="17" width="28" height="6" fill="#fff" stroke={ink} /><path d="M6 19 H22 M18 21 H34" stroke={glass} strokeWidth="1.6" /></>;
  else if (style === "louvered") body = <><rect x="10" y="17" width="20" height="6" fill="#fff" stroke={ink} /><path d="M13 22 l3 -4 M18 22 l3 -4 M23 22 l3 -4" stroke={glass} /></>;
  else {
    const n = style === "three_panel" ? 3 : 2;
    body = <><rect x="6" y="17" width="28" height="6" fill="#fff" stroke={ink} /><path d="M6 20 H34" stroke={glass} strokeWidth="1.6" />
      {Array.from({ length: n - 1 }, (_, i) => <path key={i} d={`M${6 + (28 * (i + 1)) / n} 17 V23`} stroke={ink} />)}</>;
  }
  return <svg viewBox="0 0 40 26" className="h-7 w-10 shrink-0" aria-hidden>{wall}{body}</svg>;
}

function ProjectRow({ project, current, onOpen, onRename, onDelete }: {
  project: ProjectInfo; current: boolean; onOpen: () => void; onRename: (name: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);
  const commit = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== project.name) onRename(name.trim());
    else setName(project.name);
  };
  return (
    <li className={`group flex items-center gap-1 rounded-lg pr-1 ${current ? "bg-brand-50" : "hover:bg-slate-50"}`}>
      {editing ? (
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} aria-label="Project name"
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setName(project.name); setEditing(false); } }}
          className="m-1.5 min-w-0 flex-1 rounded-md border border-brand-300 px-2 py-1.5 text-sm outline-none" />
      ) : (
        <button onClick={onOpen} className={`min-w-0 flex-1 px-3 py-2.5 text-left text-sm ${current ? "font-semibold text-brand-700" : ""}`}>
          <span className="block truncate">{project.name}</span>
          <span className="block text-xs font-normal text-slate-500">{new Date(project.updated_at).toLocaleString()}</span>
        </button>
      )}
      {!editing && (
        <span className="flex opacity-60 group-hover:opacity-100 focus-within:opacity-100">
          <button title="Rename" aria-label={`Rename ${project.name}`} onClick={() => setEditing(true)}
            className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-brand-700"><Pencil size={14} /></button>
          <button title="Delete" aria-label={`Delete ${project.name}`}
            onClick={() => { if (window.confirm(`Delete "${project.name}"? This can't be undone.`)) onDelete(); }}
            className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-red-600"><Trash2 size={14} /></button>
        </span>
      )}
    </li>
  );
}

function ReadReport({ report }: { report: SketchReport }) {
  const s = report.stats;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
        <CheckCircle2 size={15} /> Read {s.walls} walls, {s.rooms} rooms and {s.sizes_used} sizes
      </p>
      {report.warnings.length > 0 && (
        <>
          <p className="flex items-center gap-1.5 font-semibold text-amber-800">
            <AlertTriangle size={14} /> Please check ({report.warnings.length})
          </p>
          <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-4 text-slate-700">
            {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </>
      )}
      <p className="text-slate-500">Fix anything that is off in the 2D plan: drag walls, or click one to type its length.</p>
    </div>
  );
}

const LAYER_COLORS: Record<string, string> = { cement_plaster: "#d9d4cc", clay_brick: "#c4623f", insulation: "#e8cf6a", gypsum: "#efefef" };
const ROOM_TYPES: RoomType[] = ["bedroom", "living", "dining", "kitchen", "toilet", "puja", "stair", "parking", "foyer", "utility", "balcony", "store", "other"];
const SIDES: Side[] = ["east", "west", "north", "south"];
const title = (s: string) => s[0].toUpperCase() + s.slice(1);

type Edit = (next: BuildingModel) => void;

export function RightPanel(props: {
  model: BuildingModel;
  layers: LayerState;
  onLayers: (l: LayerState) => void;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onEdit: Edit;
  onCloseUp: (t: CloseUpTarget) => void;
  onFocusRoom: (id: string) => void;
  footer: ReactNode;
}) {
  const { model, selection, onEdit } = props;
  const [tab, setTab] = useState<"Details" | "Measurements" | "Layers">("Details");
  const floor = model.floors[0];
  const wall = selection?.kind === "wall" ? floor.walls.find((w) => w.id === selection.id) : undefined;
  const opening = selection?.kind === "opening" ? floor.openings.find((o) => o.id === selection.id) : undefined;
  const room = selection?.kind === "room" ? floor.rooms.find((r) => r.id === selection.id) : undefined;
  const item = selection?.kind === "furniture" ? floor.furniture.find((f) => f.id === selection.id) : undefined;
  const back = <button onClick={() => props.onSelect(null)} className="text-xs text-brand-700 hover:underline">Back to summary</button>;

  return (
    <aside className="flex flex-col rounded-2xl border border-black/5 bg-white shadow-sm">
      <Tabs tabs={["Details", "Measurements", "Layers"]} value={tab} onChange={setTab} />
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "Details" && wall && (
          <>
            <Header title="Selected Wall" action={back} />
            <div className="mb-4 space-y-3 rounded-xl border border-slate-100 p-3">
              <Field label="Length">
                <LengthInput value={wallLength(wall)} onCommit={(mm) => onEdit(setWallLength(model, wall.id, mm))} />
              </Field>
              <Field label="Type">
                <Select value={wall.type} options={["exterior", "interior"]} labels={{ exterior: 'External (9")', interior: 'Internal (4.5")' }}
                  onChange={(t) => onEdit(setWallType(model, wall.id, t as "exterior" | "interior"))} />
              </Field>
              <ZoomButton label="Zoom into wall: layers, bricks, wires, pipes" onClick={() => props.onCloseUp({ kind: "wall", id: wall.id })} />
              <DeleteButton label="Delete wall" onClick={() => { onEdit(deleteWall(model, wall.id)); props.onSelect(null); }} />
            </div>
            <WallDetails model={model} wallId={wall.id} />
          </>
        )}

        {tab === "Details" && opening && (
          <>
            <Header title={openingLabel(opening)} action={back} />
            <PresetPicker opening={opening} onPick={(p) => onEdit(applyPreset(model, opening.id, p))} />
            <div className="mt-3 space-y-3 rounded-xl border border-slate-100 p-3">
              <Field label="Width"><LengthInput value={opening.width} onCommit={(mm) => onEdit(updateOpening(model, opening.id, { width: mm }))} /></Field>
              <Field label="Height"><LengthInput value={opening.height} onCommit={(mm) => onEdit(updateOpening(model, opening.id, { height: Math.min(mm, floor.height - opening.sill) }))} /></Field>
              {opening.kind !== "door" && opening.kind !== "opening" && (
                <Field label="Sill"><LengthInput value={opening.sill} onCommit={(mm) => onEdit(updateOpening(model, opening.id, { sill: Math.min(mm, floor.height - opening.height) }))} /></Field>
              )}
              <Field label="From wall start"><LengthInput value={opening.offset} onCommit={(mm) => onEdit(updateOpening(model, opening.id, { offset: mm }))} /></Field>
              {opening.kind === "door" && (
                <button onClick={() => onEdit(updateOpening(model, opening.id, { side: opening.side === 1 ? -1 : 1 }))}
                  className="w-full rounded-lg border border-slate-200 py-2 text-sm font-medium hover:bg-slate-50">
                  Flip swing side
                </button>
              )}
              <ZoomButton label="Construction close-up" onClick={() => props.onCloseUp({ kind: "opening", id: opening.id })} />
              <DeleteButton label={`Delete ${opening.kind}`} onClick={() => { onEdit(deleteOpening(model, opening.id)); props.onSelect(null); }} />
            </div>
          </>
        )}

        {tab === "Details" && item && (
          <>
            <Header title={`Selected ${FURNITURE[item.type]?.label ?? "Furniture"}`} action={back} />
            <div className="space-y-3 rounded-xl border border-slate-100 p-3">
              <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
                <dt className="text-slate-500">Size</dt><dd className="text-right">{ftIn(item.size[0])} × {ftIn(item.size[1])}</dd>
                <dt className="text-slate-500">Turned</dt><dd className="text-right">{Math.round(item.rot)}°</dd>
              </dl>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => onEdit(rotateFurniture(model, item.id, 90))} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-sm font-medium hover:bg-slate-50">
                  <RotateCcw size={15} /> Turn left
                </button>
                <button onClick={() => onEdit(rotateFurniture(model, item.id, -90))} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-sm font-medium hover:bg-slate-50">
                  <RotateCw size={15} /> Turn right
                </button>
              </div>
              <DeleteButton label="Remove" onClick={() => { onEdit(deleteFurniture(model, item.id)); props.onSelect(null); }} />
              <p className="text-xs text-slate-500">Drag it in the plan to move it. Shortcut: R turns it, Delete removes it.</p>
            </div>
          </>
        )}

        {tab === "Details" && room && (
          <>
            <Header title="Selected Room" action={back} />
            <div className="space-y-3 rounded-xl border border-slate-100 p-3">
              <Field label="Name"><TextInput value={room.name} onCommit={(name) => name && onEdit(updateRoom(model, room.id, { name }))} /></Field>
              <Field label="Use">
                <Select value={room.type} options={ROOM_TYPES} onChange={(t) => onEdit(updateRoom(model, room.id, { type: t as RoomType }))} />
              </Field>
              <dl className="grid grid-cols-2 gap-y-1.5 pt-1 text-sm">
                <dt className="text-slate-500">Size</dt><dd className="text-right">{roomSize(room)}</dd>
                <dt className="text-slate-500">Area</dt><dd className="text-right">{Math.round(sqft(polygonArea(room.polygon)))} sq ft</dd>
              </dl>
              <Field label="Add furniture">
                <select value="" aria-label="Add furniture" className="max-w-44 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const [next, id] = addFurniture(model, e.target.value, centroid(room.polygon));
                    onEdit(next);
                    props.onSelect({ kind: "furniture", id });
                  }}>
                  <option value="">Choose…</option>
                  {Object.entries(FURNITURE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <ZoomButton label="Look inside this room in 3D" onClick={() => props.onFocusRoom(room.id)} />
              <ZoomButton label="Floor build-up close-up" onClick={() => props.onCloseUp({ kind: "floor", roomId: room.id })} />
              <p className="text-xs text-slate-500">Rooms come from closed loops of walls; move the walls to resize the room.</p>
            </div>
          </>
        )}

        {tab === "Details" && !selection && (
          <>
            <Summary model={model} onEdit={onEdit} />
            <div className="mt-3"><ZoomButton label="Roof build-up close-up" onClick={() => props.onCloseUp({ kind: "roof" })} /></div>
          </>
        )}

        {tab === "Measurements" && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="pb-2 font-medium">Room</th><th className="pb-2 font-medium">Size</th><th className="pb-2 text-right font-medium">Area</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {floor.rooms.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => { props.onSelect({ kind: "room", id: r.id }); setTab("Details"); }}>
                  <td className="py-2">{r.name}</td>
                  <td className="py-2 text-slate-600">{roomSize(r)}</td>
                  <td className="py-2 text-right">{Math.round(sqft(polygonArea(r.polygon)))} sq ft</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2" colSpan={2}>Carpet area (rooms)</td>
                <td className="py-2 text-right">{Math.round(floor.rooms.reduce((a, r) => a + sqft(polygonArea(r.polygon)), 0))} sq ft</td>
              </tr>
            </tbody>
          </table>
        )}

        {tab === "Layers" && (
          <ul className="space-y-1">
            <li>
              <label className="flex items-center justify-between rounded-lg px-2 py-2.5 text-sm">
                <span className="flex items-center gap-2"><Layers size={16} className="text-slate-500" /> 3D roof & walls</span>
                <select value={props.layers.cut} onChange={(e) => props.onLayers({ ...props.layers, cut: e.target.value as LayerState["cut"] })}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm">
                  <option value="auto">Auto</option><option value="roof">Roof</option>
                  <option value="open">Cutaway</option><option value="doll">Doll-house</option>
                </select>
              </label>
            </li>
            {([
              ["furniture", "Furniture"],
              ["labels", "Room labels (2D)"],
              ["dimensions", "Dimensions & margins (2D)"],
            ] as const).map(([key, label]) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2.5 text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-2"><Layers size={16} className="text-slate-500" /> {label}</span>
                  <input type="checkbox" className="size-4 accent-brand-600" checked={props.layers[key]}
                    onChange={(e) => props.onLayers({ ...props.layers, [key]: e.target.checked })} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3 border-t border-slate-100 p-4">
        <button
          onClick={() => { setTab("Details"); const w = floor.walls.find((w) => w.type === "exterior"); props.onSelect(w ? { kind: "wall", id: w.id } : null); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          <Ruler size={17} /> See Construction Details
        </button>
        {props.footer}
      </div>
    </aside>
  );
}

function Summary({ model, onEdit }: { model: BuildingModel; onEdit: Edit }) {
  const s = summary(model);
  const sb = model.plot.setbacks;
  const setSetback = (key: keyof typeof sb, mm: number) => onEdit({ ...model, plot: { ...model.plot, setbacks: { ...sb, [key]: mm } } });
  return (
    <>
      <h2 className="mb-3 font-semibold">Project Summary</h2>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-100 text-sm">
        <Row icon={<Frame size={17} />} label="Plot Size">
          {ftIn(s.plot.w)} × {ftIn(s.plot.h)}
          <span className="block text-xs text-slate-500">({Math.round(s.plotArea).toLocaleString()} sq ft)</span>
        </Row>
        <Row icon={<Compass size={17} />} label="Facing">{s.facing}</Row>
        <Row icon={<SquareDashed size={17} />} label="Margins">
          <span className="text-xs leading-5">F {ftIn(sb.front)} · R {ftIn(sb.rear)}<br />L {ftIn(sb.left)} · R {ftIn(sb.right)}</span>
        </Row>
        <Row icon={<BedDouble size={17} />} label="Bedrooms">{s.bedrooms}</Row>
        <Row icon={<ShowerHead size={17} />} label="Toilets">{s.toilets}</Row>
        <Row icon={<Car size={17} />} label="Parking">
          {s.parking.length}{s.parking[0] && <span className="text-xs text-slate-500"> ({roomSize(s.parking[0])})</span>}
        </Row>
        <Row icon={<Building2 size={17} />} label="Built-up Area">≈ {Math.round(s.builtUp).toLocaleString()} sq ft</Row>
      </dl>

      <h3 className="mt-5 mb-2 text-sm font-semibold">Plot & Site</h3>
      <div className="space-y-3 rounded-xl border border-slate-100 p-3">
        <Field label="Project name"><TextInput value={model.name} onCommit={(name) => name && onEdit({ ...model, name })} /></Field>
        <Field label="Plot size">
          <TextInput value={`${ftIn(s.plot.w)} x ${ftIn(s.plot.h)}`} placeholder="e.g. 30x40"
            onCommit={(t) => { const size = parseSize(t); if (size) onEdit(setPlotSize(model, ...size)); return !!size; }} />
        </Field>
        <Field label="Road side">
          <Select value={model.plot.road_sides[0]} options={SIDES} onChange={(v) => onEdit(setRoadSide(model, v as Side))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {(["front", "rear", "left", "right"] as const).map((k) => (
            <Field key={k} label={`${title(k)} margin`} stacked>
              <LengthInput value={sb[k]} onCommit={(mm) => setSetback(k, mm)} />
            </Field>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Tip: click a wall, door, window or room in the 2D plan to edit it.</p>
    </>
  );
}

function WallDetails({ model, wallId }: { model: BuildingModel; wallId: string }) {
  const floor = model.floors[0];
  const wall = floor.walls.find((w) => w.id === wallId)!;
  const assembly = wall.assembly ? model.assemblies[wall.assembly] : null;
  return (
    <>
      <h3 className="mb-2 text-sm font-semibold">{assembly?.name ?? "Wall"} · Key Specifications</h3>
      <dl className="mb-4 grid grid-cols-2 gap-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
        <dt className="text-slate-500">Height</dt><dd className="text-right">{ftIn(floor.height)} ({(floor.height / 1000).toFixed(2)} m)</dd>
        <dt className="text-slate-500">Thickness</dt><dd className="text-right">{Math.round(wall.thickness)} mm</dd>
        <dt className="text-slate-500">Area</dt><dd className="text-right">{sqft(wallLength(wall) * floor.height).toFixed(0)} sq ft</dd>
        {assembly && <><dt className="text-slate-500">Function</dt><dd className="text-right text-xs">{assembly.function}</dd></>}
      </dl>
      {assembly && (
        <>
          <h3 className="mb-2 text-sm font-semibold">Layer Composition</h3>
          <div className="mb-3 flex h-10 overflow-hidden rounded-lg border border-slate-200">
            {assembly.layers.map((l, i) => (
              <div key={i} style={{ flexGrow: l.thickness, background: LAYER_COLORS[l.material] ?? "#ddd" }} title={l.name} />
            ))}
          </div>
          <ul className="space-y-1.5 text-sm">
            {assembly.layers.map((l, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="size-3.5 rounded" style={{ background: LAYER_COLORS[l.material] ?? "#ddd" }} />
                <span className="flex-1">{l.name}</span>
                <span className="text-slate-500">{l.thickness} mm</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Header({ title, action }: { title: string; action: ReactNode }) {
  return <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{title}</h2>{action}</div>;
}

function Field({ label, children, stacked }: { label: string; children: ReactNode; stacked?: boolean }) {
  return (
    <label className={`flex gap-2 text-sm ${stacked ? "flex-col" : "items-center justify-between"}`}>
      <span className="shrink-0 text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-right text-sm outline-none focus:border-brand-500";

/** Text field that commits on Enter/blur; onCommit may return false to flag the value as invalid. */
function TextInput({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => boolean | void | "" ; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value); setBad(false); }, [value]);
  const commit = () => { if (text !== value) setBad(onCommit(text.trim()) === false); };
  return (
    <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setText(value); }}
      className={`${inputCls} max-w-44 ${bad ? "border-red-400 bg-red-50" : "border-slate-200"}`} />
  );
}

/** Accepts 12'6", 12'-6", 12.5', 3.8m, 3810mm, or a bare number of feet. */
function LengthInput({ value, onCommit }: { value: number; onCommit: (mm: number) => void }) {
  return (
    <TextInput value={ftIn(value)} onCommit={(t) => {
      const mm = parseLength(t);
      if (mm === null || mm <= 0) return false;
      onCommit(mm);
    }} />
  );
}

function Select({ value, options, labels, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-44 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? title(o)}</option>)}
    </select>
  );
}

function ZoomButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100">
      <Layers size={15} /> {label}
    </button>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
      <Trash2 size={15} /> {label}
    </button>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="mt-0.5 text-brand-600">{icon}</span>
      <dt className="flex-1 text-slate-600">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
