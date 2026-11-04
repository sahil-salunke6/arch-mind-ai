import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box as BoxIcon, Maximize2, SquareDashed } from "lucide-react";
import { api, type ProjectInfo, type SketchReport } from "./lib/api";
import { VIEWS, type BuildingModel, type Focus, type Layers, type Selection, type Tool, type ViewName } from "./types";
import { DownloadMenu, Stepper, TopNav, type SaveStatus } from "./components/Chrome";
import { blankProject, deleteFurniture, deleteOpening, deleteWall, rotateFurniture } from "./lib/edit";
import { useHistory } from "./lib/history";
import { LeftPanel, RightPanel, type Upload } from "./components/Panels";
import PlanView2D from "./components/PlanView2D";
import SketchView from "./components/SketchView";
import Viewer3D, { walkKeys } from "./components/Viewer3D";
import CloseUp, { type CloseUpTarget } from "./components/CloseUp";

type Layout = "Compare" | "2D Plan" | "3D Model";

export default function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const history = useHistory<BuildingModel>(null);
  const model = history.present;
  const [status, setStatus] = useState<SaveStatus>("saved");
  const dirty = useRef(false);
  const saving = useRef(false);
  const [saveTick, setSaveTick] = useState(0);
  const latest = useRef<BuildingModel | null>(null);
  latest.current = model;
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [reports, setReports] = useState<Record<string, SketchReport>>({});
  const [layout, setLayout] = useState<Layout>("Compare");
  const [view, setView] = useState<ViewName>("NE");
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [layers, setLayers] = useState<Layers>({ cut: "auto", furniture: true, labels: true, dimensions: true });
  const [rawSelection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [closeUp, setCloseUp] = useState<CloseUpTarget | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [walking, setWalking] = useState(false);
  const goTo = (f: Focus) => { setFocus(f); setWalking(false); setLayout("3D Model"); };
  const openCloseUp = (t: CloseUpTarget) => { setCloseUp(t); setLayout("3D Model"); };
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<ViewName, string>>>({});

  const open = useCallback(async (id: string) => {
    try {
      history.reset(await api.get(id));
      dirty.current = false;
      setStatus("saved");
      setProjectId(id);
      setSelection(null);
      setThumbs({});
    } catch (e) {
      setError(`Could not load the project (${e}). Is the API running on port 8000?`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshList = useCallback(() => api.list().then(setProjects), []);

  useEffect(() => {
    api.list()
      .then((list) => { setProjects(list); if (list[0]) open(list[0].id); })
      .catch((e) => setError(`Could not reach the API (${e}). Start it with: npm run api`));
  }, [open]);

  /** All edits go through here. commit=false updates the current undo step (live drags). */
  const edit = useCallback((next: BuildingModel, commit = true) => {
    if (commit) history.commit(next);
    else history.replace(next);
    dirty.current = true;
    setStatus("unsaved");
  }, [history.commit, history.replace]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = () => { history.undo(); dirty.current = true; setStatus("unsaved"); };
  const redo = () => { history.redo(); dirty.current = true; setStatus("unsaved"); };

  // Autosave shortly after the last edit. The server re-derives rooms from the walls; take its rooms
  // only if the walls haven't changed again in the meantime.
  useEffect(() => {
    if (!dirty.current || !model || !projectId) return;
    const t = setTimeout(async () => {
      // one save at a time: a newer edit waits for this one, then saves on top of its rooms
      if (saving.current) { setSaveTick((n) => n + 1); return; }
      saving.current = true;
      dirty.current = false;
      setStatus("saving");
      const sentWalls = JSON.stringify(model.floors[0].walls);
      try {
        const saved = await api.save(projectId, model);
        const now = latest.current;
        if (now && JSON.stringify(now.floors[0].walls) === sentWalls) {
          history.replace({ ...now, floors: [{ ...now.floors[0], rooms: saved.floors[0].rooms }, ...now.floors.slice(1)] });
        }
        if (!dirty.current) setStatus("saved");
        refreshList();
      } catch {
        dirty.current = true;
        setStatus("error");
      } finally {
        saving.current = false;
        if (dirty.current) setSaveTick((n) => n + 1);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [model, projectId, saveTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop a selection whose element no longer exists (deleted, undone, room re-derived).
  const selection = useMemo<Selection>(() => {
    if (!rawSelection || !model) return null;
    const f = model.floors[0];
    const list: { id: string }[] = { wall: f.walls, opening: f.openings, room: f.rooms, furniture: f.furniture }[rawSelection.kind];
    return list.some((x) => x.id === rawSelection.id) ? rawSelection : null;
  }, [rawSelection, model]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selection && model) {
        if (selection.kind === "wall") edit(deleteWall(model, selection.id));
        if (selection.kind === "opening") edit(deleteOpening(model, selection.id));
        if (selection.kind === "furniture") edit(deleteFurniture(model, selection.id));
      } else if (!mod && e.key.toLowerCase() === "r" && selection?.kind === "furniture" && model) {
        edit(rotateFurniture(model, selection.id, e.shiftKey ? -90 : 90));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const newProject = async (kind: "blank" | "sample") => {
    if (!model) return;
    const { id } = kind === "blank" ? await api.create(blankProject(model, "New Plot 30x40")) : await api.createFromSample();
    await refreshList();
    await open(id);
    if (kind === "blank") { setLayout("2D Plan"); setTool("wall"); }
  };

  const renameProject = async (id: string, name: string) => {
    try {
      if (id === projectId && model) edit({ ...model, name });  // saved with the next autosave
      else await api.rename(id, name);
      setProjects((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
    } catch (e) {
      window.alert(`Couldn't rename the project: ${(e as Error).message}`);
    }
  };

  const deleteProject = async (id: string) => {
    try {
      await api.remove(id);
    } catch (e) {
      window.alert(`Couldn't delete the project: ${(e as Error).message}`);
      return;
    }
    setReports(({ [id]: _, ...rest }) => rest);
    const list = await api.list();
    setProjects(list);
    if (id !== projectId) return;
    if (list[0]) await open(list[0].id);
    else { const { id: fresh } = await api.createFromSample(); await refreshList(); await open(fresh); }
  };

  const pickView = (v: ViewName) => {
    setView(v);
    setFocus(null);
    setWalking(false);
    if (layout === "2D Plan") setLayout("3D Model");
  };

  const onUpload = (f: File) => {
    if (upload) URL.revokeObjectURL(upload.url);
    setUpload({ name: f.name, url: URL.createObjectURL(f), file: f });
    setNotice(null);
  };

  const onGenerate = async () => {
    if (!upload) {
      setNotice(prompt.trim()
        ? "Prompt-to-design is planned for Phase 3. Upload a photo of a hand-drawn plan to try sketch reading."
        : "Upload a photo of your hand-drawn plan first.");
      return;
    }
    setNotice(null);
    setReading(true);
    try {
      const { id, report } = await api.readSketch(upload.file);
      setReports((r) => ({ ...r, [id]: report }));
      await refreshList();
      await open(id);
      setLayout("Compare");
      setView("NE");
    } catch (e) {
      setNotice(`Couldn't read this sketch: ${(e as Error).message}`);
    } finally {
      setReading(false);
    }
  };

  /** Exports are rendered from the saved model, so flush pending edits first. */
  const exportFile = async (url: string, filename: string) => {
    if (model && projectId && status !== "saved") {
      dirty.current = false;
      await api.save(projectId, model);
      setStatus("saved");
    }
    download(url, filename);
  };

  const savePng = () => {
    if (!canvas || !model) return;
    download(canvas.toDataURL("image/png"), `${model.name} - ${view}.png`);
  };
  const saveJson = () => {
    if (!model) return;
    download(URL.createObjectURL(new Blob([JSON.stringify(model, null, 2)], { type: "application/json" })), `${model.name}.json`);
  };

  if (error && !model) {
    return <div className="grid h-full place-items-center p-6 text-center text-slate-600">{error}</div>;
  }
  if (!model) return <div className="grid h-full place-items-center text-slate-500">Loading project…</div>;

  const show2D = layout !== "3D Model";
  const show3D = layout !== "2D Plan";

  return (
    <div className="flex min-h-full flex-col">
      <TopNav projects={projects} current={projectId} onOpen={open} status={status} />
      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_310px]">
        <LeftPanel
          upload={upload} onUpload={onUpload} onClear={() => { if (upload) URL.revokeObjectURL(upload.url); setUpload(null); }}
          prompt={prompt} onPrompt={setPrompt} onGenerate={onGenerate} notice={notice}
          reading={reading} report={projectId ? reports[projectId] ?? null : null}
          projects={projects} current={projectId} onOpen={open} onNew={newProject}
          onRename={renameProject} onDelete={deleteProject}
        />

        <section className="flex min-w-0 flex-col gap-3">
          <div className="rounded-2xl border border-black/5 bg-white shadow-sm"><Stepper active={reading ? 1 : 3} /></div>

          <div className="flex items-center gap-1 self-start rounded-xl border border-black/5 bg-white p-1 shadow-sm">
            {(["Compare", "2D Plan", "3D Model"] as Layout[]).map((l) => (
              <button key={l} onClick={() => setLayout(l)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium ${layout === l ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {l}
              </button>
            ))}
          </div>

          <div className={`grid min-h-[480px] flex-1 gap-3 ${layout === "Compare" ? "md:grid-cols-3" : ""}`}>
            {layout === "Compare" && (
              <Card title={projectId && reports[projectId] ? "Hand-Drawn Input (what was read)" : upload ? "Hand-Drawn Input" : "Hand-Drawn Input (sample)"}>
                <SketchView model={model} imageUrl={upload?.url ?? null} report={projectId ? reports[projectId] ?? null : null} />
              </Card>
            )}
            {show2D && (
              <Card title="2D Floor Plan" onExpand={layout === "Compare" ? () => setLayout("2D Plan") : undefined}>
                <PlanView2D
                  model={model} layers={layers} selection={selection} onSelect={setSelection}
                  editable tool={tool} onTool={setTool} onEdit={edit}
                  history={{ undo, redo, canUndo: history.canUndo, canRedo: history.canRedo }}
                />
              </Card>
            )}
            {show3D && (
              <Card title={`3D Model · ${view} view`} accent onExpand={layout === "Compare" ? () => setLayout("3D Model") : undefined}>
                {closeUp && <CloseUp model={model} target={closeUp} onEdit={(m) => edit(m)} onClose={() => setCloseUp(null)} />}
                <ExploreBar model={model} focus={focus} walking={walking} onFocus={goTo} onWalk={setWalking} />
                <CutControl value={layers.cut} onChange={(cut) => setLayers((l) => ({ ...l, cut }))} />
                <Viewer3D
                  model={model} layers={layers} view={view} mode={mode}
                  selectedWall={selection?.kind === "wall" ? selection.id : null}
                  onSelectWall={(id) => setSelection(id ? { kind: "wall", id } : null)}
                  onCanvas={setCanvas} onThumbnails={setThumbs}
                  focus={focus} walking={walking} onFocus={goTo} onCloseUp={openCloseUp}
                />
              </Card>
            )}
          </div>

          <div className="flex items-center gap-3 overflow-x-auto rounded-2xl border border-black/5 bg-white p-3 shadow-sm">
            <div className="flex shrink-0 gap-1 rounded-xl bg-slate-100 p-1">
              {(["2d", "3d"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} title={m === "2d" ? "Orthographic drawing views" : "Perspective views"}
                  className={`flex w-14 flex-col items-center gap-0.5 rounded-lg py-1.5 text-xs font-semibold ${mode === m ? "bg-brand-600 text-white" : "text-slate-600"}`}>
                  {m === "2d" ? <SquareDashed size={17} /> : <BoxIcon size={17} />} {m.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="shrink-0 text-sm font-semibold">10 Views</span>
            <div className="flex gap-2">
              {VIEWS.map((v) => (
                <button key={v} onClick={() => pickView(v)}
                  className={`flex w-[78px] shrink-0 flex-col items-center gap-1 rounded-xl border p-1 text-xs font-medium ${
                    view === v ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-200"
                  }`}>
                  {thumbs[v] ? <img src={thumbs[v]} alt="" className="h-[46px] w-full rounded-lg object-cover" /> : <span className="h-[46px] w-full rounded-lg bg-slate-100" />}
                  {v}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="lg:col-span-2 xl:col-span-1">
          <RightPanel
            model={model} layers={layers} onLayers={setLayers}
            selection={selection} onSelect={setSelection} onEdit={edit} onCloseUp={openCloseUp}
            onFocusRoom={(id) => goTo({ kind: "room", id })}
            footer={
              <DownloadMenu items={[
                { label: "Blueprint set (.pdf, A3)", onClick: () => projectId && exportFile(api.pdfUrl(projectId), `${model.name}.pdf`) },
                { label: "CAD plan (.dxf)", onClick: () => projectId && exportFile(api.dxfUrl(projectId), `${model.name}.dxf`) },
                { label: `Current view (${view}) as PNG`, onClick: savePng },
                { label: "Building model (.json)", onClick: saveJson },
              ]} />
            }
          />
          <p className="mt-3 px-1 text-[11px] leading-4 text-slate-500">
            Concept drawings only. Not for construction or approval; structural design and sanction drawings need a licensed architect/engineer.
          </p>
        </div>
      </main>
    </div>
  );
}

/** Bottom-left of the 3D view: jump into a room or outside, and start/stop walking. */
function ExploreBar({ model, focus, walking, onFocus, onWalk }: {
  model: BuildingModel; focus: Focus; walking: boolean; onFocus: (f: Focus) => void; onWalk: (w: boolean) => void;
}) {
  const value = !focus ? "house" : focus.kind === "outside" ? "outside" : focus.id;
  return (
    <div className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5">
      <select value={value} aria-label="Go to"
        onChange={(e) => onFocus(e.target.value === "house" ? null : e.target.value === "outside" ? { kind: "outside" } : { kind: "room", id: e.target.value })}
        className="rounded-lg border border-slate-200 bg-white/95 px-2 py-1.5 text-xs font-medium shadow-sm">
        <option value="house">Whole house</option>
        <option value="outside">Outside (eye level)</option>
        {model.floors[0].rooms.map((r) => <option key={r.id} value={r.id}>Inside: {r.name}</option>)}
      </select>
      <button onClick={(e) => { e.currentTarget.blur(); onWalk(!walking); }}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm ${walking ? "bg-brand-600 text-white" : "border border-slate-200 bg-white/95 text-slate-700 hover:bg-slate-50"}`}>
        {walking ? "Stop walking" : "Walk"}
      </button>
      {walking && <WalkPad />}
      <span className="rounded-lg bg-ink/75 px-2 py-1 text-[11px] text-white">
        {walking ? "Drag the view to look around · W/↑ forward · S/↓ back · ←/→ turn · A/D step sideways · Shift runs"
          : focus?.kind === "room" ? "Drag to look around, up at the ceiling and down at the floor · scroll to zoom"
            : "Double-click a room to step inside · double-click a wall for its close-up"}
      </span>
    </div>
  );
}

/** Press-and-hold buttons for walking without a keyboard (also works on touch screens). */
function WalkPad() {
  const hold = (code: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      walkKeys.add(code);
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* keep holding without capture */ }
    },
    onPointerUp: () => walkKeys.delete(code),
    onPointerCancel: () => walkKeys.delete(code),
    onLostPointerCapture: () => walkKeys.delete(code),
  });
  const cls = "grid size-8 place-items-center rounded-lg border border-slate-200 bg-white/95 text-sm font-bold text-slate-700 shadow-sm select-none active:bg-brand-600 active:text-white touch-none";
  return (
    <div className="grid grid-cols-3 gap-1" aria-label="Walk controls">
      <span />
      <button className={cls} aria-label="Walk forward" {...hold("ArrowUp")}>↑</button>
      <span />
      <button className={cls} aria-label="Turn left" {...hold("ArrowLeft")}>↶</button>
      <button className={cls} aria-label="Walk back" {...hold("ArrowDown")}>↓</button>
      <button className={cls} aria-label="Turn right" {...hold("ArrowRight")}>↷</button>
    </div>
  );
}

const CUTS: { value: Layers["cut"]; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Roof on straight-on elevations, open from above and the corners" },
  { value: "roof", label: "Roof", hint: "Closed house with roof and parapet" },
  { value: "open", label: "Cutaway", hint: "Roof removed, full-height walls" },
  { value: "doll", label: "Doll-house", hint: "Walls cut at 4 ft to see into every room" },
];

function CutControl({ value, onChange }: { value: Layers["cut"]; onChange: (v: Layers["cut"]) => void }) {
  return (
    <div className="absolute top-2 right-2 z-10 flex rounded-lg border border-slate-200 bg-white/95 p-0.5 text-[11px] font-medium shadow-sm" role="radiogroup" aria-label="3D view">
      {CUTS.map((c) => (
        <button key={c.value} role="radio" aria-checked={value === c.value} title={c.hint} onClick={() => onChange(c.value)}
          className={`rounded-md px-2 py-1 ${value === c.value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function Card({ title, children, accent, onExpand }: { title: string; children: ReactNode; accent?: boolean; onExpand?: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
      <div className={`flex items-center justify-between border-b px-4 py-2.5 text-sm font-semibold ${accent ? "border-brand-200 text-brand-700" : "border-slate-100"}`}>
        {title}
        {onExpand && (
          <button onClick={onExpand} className="text-slate-400 hover:text-brand-600" aria-label="Expand"><Maximize2 size={15} /></button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}
