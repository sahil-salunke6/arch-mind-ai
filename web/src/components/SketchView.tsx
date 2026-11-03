import { useMemo, useState } from "react";
import rough from "roughjs";
import type { SketchReport } from "../lib/api";
import type { BuildingModel, Point } from "../types";
import { bbox, pointOnWall, solidSpans, wallLength } from "../lib/geometry";

const S = 0.03; // px per mm: roughjs wobble is tuned for pixel-sized drawings
const INK = "#2c3e94";

/** The model redrawn as a pen-on-paper sketch, standing in for the user's photo in the demo. */
const ROLE_COLORS: Record<string, string> = {
  room: "#2563eb", size: "#059669", length: "#0d9488", margin: "#0d9488", gate: "#0d9488", road: "#0d9488",
};

/** The processed photo with what the reader found drawn on top: the check screen. */
function ReadOverlay({ report }: { report: SketchReport }) {
  const o = report.overlay;
  const [show, setShow] = useState(true);
  if (!o.image) return null;
  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${o.width} ${o.height}`} className="h-full w-full">
        <image href={o.image} width={o.width} height={o.height} />
        {show && (
          <g fill="none" strokeLinecap="round">
            {o.ignored.map((s, i) => <line key={`i${i}`} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="#94a3b8" strokeWidth={3} strokeDasharray="6 6" />)}
            {o.plot && <rect x={o.plot[0]} y={o.plot[1]} width={o.plot[2] - o.plot[0]} height={o.plot[3] - o.plot[1]} stroke="#16a34a" strokeWidth={5} strokeDasharray="14 8" />}
            {o.walls.map((s, i) => <line key={`w${i}`} x1={s[0]} y1={s[1]} x2={s[2]} y2={s[3]} stroke="#6a45f5" strokeWidth={7} strokeOpacity={0.75} />)}
            {o.stairs.map((r, i) => <rect key={`s${i}`} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} stroke="#f59e0b" strokeWidth={4} />)}
            {o.labels.filter((l) => l.role !== "note").map((l, i) => (
              <polygon key={`l${i}`} points={l.box.map((p) => p.join(",")).join(" ")} stroke={ROLE_COLORS[l.role] ?? "#64748b"} strokeWidth={2.5}
                fill={ROLE_COLORS[l.role] ?? "#64748b"} fillOpacity={0.08} />
            ))}
          </g>
        )}
      </svg>
      <label className="absolute top-2 right-2 flex items-center gap-1.5 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-medium shadow-sm">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-brand-600" /> Show what was read
      </label>
      {show && (
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-lg bg-white/90 px-2 py-1 text-[10px] shadow-sm">
          <Key color="#6a45f5" label="Walls" /><Key color="#16a34a" label="Plot" /><Key color="#f59e0b" label="Stairs" />
          <Key color="#2563eb" label="Room names" /><Key color="#059669" label="Sizes" />
        </div>
      )}
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: color }} />{label}</span>;
}

export default function SketchView({ model, imageUrl, report }: { model: BuildingModel; imageUrl: string | null; report?: SketchReport | null }) {
  const plot = bbox(model.plot.polygon);
  const floor = model.floors[0];
  const tx = ([x, y]: Point): [number, number] => [(x - plot.x0) * S + 70, (plot.y1 - y) * S + 60];

  const paths = useMemo(() => {
    const gen = rough.generator();
    const opt = { stroke: INK, strokeWidth: 1.1, roughness: 1.3, bowing: 1.5, seed: 7 };
    const out: ReturnType<typeof gen.toPaths> = [];
    const add = (d: Parameters<typeof gen.toPaths>[0]) => out.push(...gen.toPaths(d));
    const line = (a: Point, b: Point, o = {}) => add(gen.line(...tx(a), ...tx(b), { ...opt, ...o }));

    add(gen.polygon(model.plot.polygon.map(tx), { ...opt, strokeWidth: 1.4 }));
    for (const w of floor.walls) {
      for (const [s0, s1] of solidSpans(w, floor.openings)) {
        const a0 = Math.max(s0, 0), a1 = Math.min(s1, wallLength(w));
        const k = w.type === "exterior" ? w.thickness / 2 : 0;
        line(pointOnWall(w, a0, k), pointOnWall(w, a1, k), { strokeWidth: w.type === "exterior" ? 1.6 : 1.2 });
        if (k) line(pointOnWall(w, a0, -k), pointOnWall(w, a1, -k));
      }
    }
    for (const o of floor.openings.filter((o) => o.kind === "door")) {
      const w = floor.walls.find((w) => w.id === o.wall)!;
      const [cx, cy] = tx(pointOnWall(w, o.offset, 0));
      const [lx, ly] = tx(pointOnWall(w, o.offset, o.width * o.side));
      const [ex, ey] = tx(pointOnWall(w, o.offset + o.width, 0));
      const a = Math.atan2(ly - cy, lx - cx), b = Math.atan2(ey - cy, ex - cx);
      let start = Math.min(a, b), stop = Math.max(a, b);
      if (stop - start > Math.PI) [start, stop] = [stop, start + 2 * Math.PI];
      add(gen.arc(cx, cy, o.width * S * 2, o.width * S * 2, start, stop, false, { ...opt, strokeWidth: 0.9 }));
    }
    for (const r of floor.rooms.filter((r) => r.type === "stair")) {
      const b = bbox(r.polygon);
      for (let x = b.x0 + 300; x < b.x1 - b.h / 2; x += 300) line([x, b.y0], [x, b.y1], { strokeWidth: 0.8 });
    }
    // dimension arrows
    line([plot.x0 + 300, plot.y1 + 900], [plot.x1 - 300, plot.y1 + 900]);
    line([plot.x0 - 900, plot.y0 + 300], [plot.x0 - 900, plot.y1 - 300]);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  if (report?.overlay.image) return <ReadOverlay report={report} />;
  if (imageUrl) {
    return <img src={imageUrl} alt="Uploaded hand drawing" className="h-full w-full object-contain" />;
  }

  const W = plot.w * S + 140, H = plot.h * S + 170;
  const road = model.plot.road_sides.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" style={{ fontFamily: "var(--font-hand)" }}>
      <defs>
        <pattern id="paper-lines" width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M14 0H0V14" fill="none" stroke="#e5e1d6" strokeWidth="0.4" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="#f8f6f0" />
      <rect width={W} height={H} fill="url(#paper-lines)" />
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? "none"} strokeLinecap="round" />
      ))}
      <g fill={INK} textAnchor="middle">
        <text x={tx([plot.cx, 0])[0]} y={tx([0, plot.y1 + 1300])[1]} fontSize={15}>{Math.round(plot.w / 304.8)} ft</text>
        <text transform={`translate(${tx([plot.x0 - 1300, 0])[0]} ${tx([0, plot.cy])[1]}) rotate(-90)`} fontSize={15}>
          {Math.round(plot.h / 304.8)} ft
        </text>
        {floor.rooms.map((r) => {
          const b = bbox(r.polygon);
          const [x, y] = tx([b.cx, b.cy]);
          const small = Math.min(b.w, b.h) < 2400;
          const name = r.label_raw ?? r.name.replace("Living / Dining", "Living/Dining");
          return (
            <g key={r.id} fontSize={small ? 8.5 : 12}>
              <text x={x} y={y - 2}>{name}</text>
              <text x={x} y={y + (small ? 9 : 14)} fontSize={small ? 7.5 : 10.5}>
                {Math.round(b.w / 304.8)}' x {Math.round(b.h / 304.8)}'
              </text>
            </g>
          );
        })}
        <text x={W / 2} y={H - 18} fontSize={15}>Road ({road})</text>
        <text x={W - 30} y={34} fontSize={14} transform={`rotate(${model.north_deg} ${W - 30} 40)`}>N ↑</text>
      </g>
    </svg>
  );
}
