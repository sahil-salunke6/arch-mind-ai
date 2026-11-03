import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Box as BoxIcon, Maximize2, SquareDashed } from "lucide-react";
import { api, type ProjectInfo } from "./lib/api";
import { VIEWS, type BuildingModel, type Layers, type ViewName } from "./types";
import { DownloadMenu, Stepper, TopNav } from "./components/Chrome";
import { LeftPanel, RightPanel, type Upload } from "./components/Panels";
import PlanView2D from "./components/PlanView2D";
import SketchView from "./components/SketchView";
import Viewer3D from "./components/Viewer3D";

type Layout = "Compare" | "2D Plan" | "3D Model";

export default function App() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [model, setModel] = useState<BuildingModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("Compare");
  const [view, setView] = useState<ViewName>("NE");
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [layers, setLayers] = useState<Layers>({ roof: false, furniture: true, labels: true, dimensions: true });
  const [selectedWall, setSelectedWall] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<ViewName, string>>>({});

  const open = useCallback(async (id: string) => {
    try {
      setModel(await api.get(id));
      setProjectId(id);
      setSelectedWall(null);
      setThumbs({});
    } catch (e) {
      setError(`Could not load the project (${e}). Is the API running on port 8000?`);
    }
  }, []);

  useEffect(() => {
    api.list()
      .then((list) => { setProjects(list); if (list[0]) open(list[0].id); })
      .catch((e) => setError(`Could not reach the API (${e}). Start it with: npm run api`));
  }, [open]);

  const pickView = (v: ViewName) => {
    setView(v);
    // Top reads best as a cutaway, elevations need the roof; corner views keep the user's choice.
    if (v === "Top") setLayers((l) => ({ ...l, roof: false }));
    else if (["North", "South", "East", "West"].includes(v)) setLayers((l) => ({ ...l, roof: true }));
    if (layout === "2D Plan") setLayout("3D Model");
  };

  const onUpload = (f: File) => {
    if (upload) URL.revokeObjectURL(upload.url);
    setUpload({ name: f.name, url: URL.createObjectURL(f) });
    setNotice(null);
  };

  const onGenerate = () => {
    setNotice(
      upload
        ? "Your sketch is shown on the left. Automatic sketch reading is being built (Phase 1), so the plan and 3D model show the sample project for now."
        : prompt.trim()
          ? "Prompt-to-design is planned for Phase 3. Showing the sample project for now."
          : "Upload a sketch or describe your house. Meanwhile, explore the sample project.",
    );
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
      <TopNav projects={projects} current={projectId} onOpen={open} />
      <main className="grid flex-1 gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_310px]">
        <LeftPanel
          upload={upload} onUpload={onUpload} onClear={() => { if (upload) URL.revokeObjectURL(upload.url); setUpload(null); }}
          prompt={prompt} onPrompt={setPrompt} onGenerate={onGenerate} notice={notice}
          projects={projects} current={projectId} onOpen={open}
        />

        <section className="flex min-w-0 flex-col gap-3">
          <div className="rounded-2xl border border-black/5 bg-white shadow-sm"><Stepper active={3} /></div>

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
              <Card title={upload ? "Hand-Drawn Input" : "Hand-Drawn Input (sample)"}>
                <SketchView model={model} imageUrl={upload?.url ?? null} />
              </Card>
            )}
            {show2D && (
              <Card title="2D Floor Plan (Generated)" onExpand={layout === "Compare" ? () => setLayout("2D Plan") : undefined}>
                <PlanView2D model={model} layers={layers} selectedWall={selectedWall} onSelectWall={setSelectedWall} />
              </Card>
            )}
            {show3D && (
              <Card title={`3D Model · ${view} view`} accent onExpand={layout === "Compare" ? () => setLayout("3D Model") : undefined}>
                <Viewer3D
                  model={model} layers={layers} view={view} mode={mode}
                  selectedWall={selectedWall} onSelectWall={setSelectedWall}
                  onCanvas={setCanvas} onThumbnails={setThumbs}
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
            selectedWall={selectedWall} onSelectWall={setSelectedWall}
            footer={
              <DownloadMenu items={[
                { label: "Blueprint set (.pdf, A3)", onClick: () => projectId && download(api.pdfUrl(projectId), `${model.name}.pdf`) },
                { label: "CAD plan (.dxf)", onClick: () => projectId && download(api.dxfUrl(projectId), `${model.name}.dxf`) },
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
