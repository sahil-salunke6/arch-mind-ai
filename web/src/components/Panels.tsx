import { useState, type ReactNode } from "react";
import {
  BedDouble, Building2, Car, Compass, Frame, ImagePlus, Info, Layers, Ruler, ShowerHead, Sparkles, SquareDashed, Trash2,
} from "lucide-react";
import type { ProjectInfo } from "../lib/api";
import type { BuildingModel, Layers as LayerState } from "../types";
import { ftIn, roomSize, sqft, polygonArea, summary, wallLength } from "../lib/geometry";

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
          <button
            onClick={props.onGenerate}
            className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 py-3 font-semibold text-white shadow-md shadow-brand-500/30 hover:brightness-110"
          >
            Generate Design <Sparkles size={17} />
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-1 p-3">
          {props.projects.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => props.onOpen(p.id)}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${p.id === props.current ? "bg-brand-50 font-semibold text-brand-700" : "hover:bg-slate-50"}`}
              >
                {p.name}
                <span className="block text-xs font-normal text-slate-500">{new Date(p.updated_at).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

const LAYER_COLORS: Record<string, string> = { cement_plaster: "#d9d4cc", clay_brick: "#c4623f", insulation: "#e8cf6a", gypsum: "#efefef" };

export function RightPanel(props: {
  model: BuildingModel;
  layers: LayerState;
  onLayers: (l: LayerState) => void;
  selectedWall: string | null;
  onSelectWall: (id: string | null) => void;
  footer: ReactNode;
}) {
  const { model } = props;
  const [tab, setTab] = useState<"Details" | "Measurements" | "Layers">("Details");
  const s = summary(model);
  const sb = model.plot.setbacks;
  const floor = model.floors[0];
  const wall = floor.walls.find((w) => w.id === props.selectedWall) ?? null;
  const assembly = wall?.assembly ? model.assemblies[wall.assembly] : null;

  return (
    <aside className="flex flex-col rounded-2xl border border-black/5 bg-white shadow-sm">
      <Tabs tabs={["Details", "Measurements", "Layers"]} value={tab} onChange={setTab} />
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "Details" && !wall && (
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
            <p className="mt-3 text-xs text-slate-500">Tip: click any wall in the plan or the 3D model to see how it is built.</p>
          </>
        )}

        {tab === "Details" && wall && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Selected Element</h2>
              <button onClick={() => props.onSelectWall(null)} className="text-xs text-brand-700 hover:underline">Back to summary</button>
            </div>
            <div className="mb-4 rounded-xl border border-slate-100 p-3">
              <p className="font-semibold">{assembly?.name ?? "Wall"} ({wall.id})</p>
              <p className="text-xs text-slate-500">{assembly?.function}</p>
            </div>
            <h3 className="mb-2 text-sm font-semibold">Key Specifications</h3>
            <dl className="mb-4 grid grid-cols-2 gap-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
              <dt className="text-slate-500">Height</dt><dd className="text-right">{ftIn(floor.height)} ({(floor.height / 1000).toFixed(2)} m)</dd>
              <dt className="text-slate-500">Length</dt><dd className="text-right">{ftIn(wallLength(wall))}</dd>
              <dt className="text-slate-500">Thickness</dt><dd className="text-right">{Math.round(wall.thickness)} mm</dd>
              <dt className="text-slate-500">Area</dt><dd className="text-right">{(sqft(wallLength(wall) * floor.height)).toFixed(0)} sq ft</dd>
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
        )}

        {tab === "Measurements" && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="pb-2 font-medium">Room</th><th className="pb-2 font-medium">Size</th><th className="pb-2 text-right font-medium">Area</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {floor.rooms.map((r) => (
                <tr key={r.id}>
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
            {([
              ["roof", "Roof & parapet"],
              ["furniture", "Furniture"],
              ["labels", "Room labels (2D)"],
              ["dimensions", "Dimensions & margins (2D)"],
            ] as const).map(([key, label]) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2.5 text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-2"><Layers size={16} className="text-slate-500" /> {label}</span>
                  <input
                    type="checkbox" className="size-4 accent-brand-600" checked={props.layers[key]}
                    onChange={(e) => props.onLayers({ ...props.layers, [key]: e.target.checked })}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3 border-t border-slate-100 p-4">
        <button
          onClick={() => { setTab("Details"); props.onSelectWall(floor.walls.find((w) => w.type === "exterior")?.id ?? null); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          <Ruler size={17} /> See Construction Details
        </button>
        {props.footer}
      </div>
    </aside>
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

