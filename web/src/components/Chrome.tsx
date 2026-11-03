import { Bell, Box, Check, ChevronDown, CircleHelp, FileDown, House, Layers3, LayoutGrid, PencilRuler, ScanSearch } from "lucide-react";
import type { ProjectInfo } from "../lib/api";

const NAV = [
  { label: "Home", icon: House },
  { label: "Design", icon: PencilRuler },
  { label: "Explore", icon: Box },
  { label: "Materials", icon: Layers3 },
  { label: "Analysis", icon: ScanSearch },
  { label: "Export", icon: LayoutGrid },
];

export function TopNav({ projects, current, onOpen }: { projects: ProjectInfo[]; current: string | null; onOpen: (id: string) => void }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-black/5 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-xl font-bold tracking-tight">ArchMind AI</span>
      </div>
      <nav className="ml-6 hidden items-center gap-1 xl:flex">
        {NAV.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium ${
              label === "Design" ? "bg-brand-100 text-brand-700" : "text-slate-600 hover:bg-slate-100"
            }`}
            title={label === "Design" ? undefined : "Coming soon"}
          >
            <Icon size={17} /> {label}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <label className="relative hidden items-center sm:flex">
          <select
            className="appearance-none rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm font-medium"
            value={current ?? ""}
            onChange={(e) => onOpen(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>Project: {p.name}</option>
            ))}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 text-slate-500" />
        </label>
        <span className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium md:flex">
          <span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white"><Check size={11} strokeWidth={3} /></span>
          Saved
        </span>
        <Bell size={20} className="hidden text-slate-600 md:block" />
        <CircleHelp size={20} className="hidden text-slate-600 md:block" />
        <span className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">A</span>
      </div>
    </header>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8">
      <defs>
        <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#8b6cff" />
          <stop offset="1" stopColor="#5a35dc" />
        </linearGradient>
      </defs>
      <path d="M16 2 L30 29 H22 L16 16 L10 29 H2 Z" fill="url(#lg)" />
      <path d="M16 16 L19.5 23 H12.5 Z" fill="#c9bbff" />
    </svg>
  );
}

const STEPS = ["Input", "Analyze (AI Reading)", "Generate Design", "Explore & Customize"];

export function Stepper({ active }: { active: number }) {
  return (
    <ol className="flex items-center justify-center gap-2 overflow-x-auto px-2 py-3 text-sm">
      {STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <li key={s} className="flex shrink-0 items-center gap-2">
            {i > 0 && <span className={`h-px w-6 sm:w-12 ${done || current ? "bg-brand-500" : "bg-slate-300"}`} />}
            <span
              className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${
                done ? "bg-brand-600 text-white" : current ? "bg-brand-600 text-white ring-4 ring-brand-100" : "border border-slate-300 text-slate-500"
              }`}
            >
              {done ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <span className={`hidden md:inline ${current ? "font-semibold text-brand-700" : "text-slate-600"}`}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function DownloadMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-100">
        <FileDown size={18} /> Download <ChevronDown size={16} className="ml-auto transition group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        {items.map((it) => (
          <button key={it.label} onClick={it.onClick} className="block w-full px-4 py-2.5 text-left text-sm hover:bg-brand-50">
            {it.label}
          </button>
        ))}
      </div>
    </details>
  );
}
