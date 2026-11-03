import { useMemo } from "react";
import rough from "roughjs";
import type { BuildingModel, Point } from "../types";
import { bbox, pointOnWall, solidSpans, wallLength } from "../lib/geometry";

const S = 0.03; // px per mm: roughjs wobble is tuned for pixel-sized drawings
const INK = "#2c3e94";

/** The model redrawn as a pen-on-paper sketch, standing in for the user's photo in the demo. */
export default function SketchView({ model, imageUrl }: { model: BuildingModel; imageUrl: string | null }) {
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
