import type { ReactNode } from "react";
import type { BuildingModel, Furniture, Layers, Point, Wall } from "../types";
import {
  bbox, ftIn, pointOnWall, ROOM_COLORS, roomSize, solidSpans, spanRect, stairLayout,
} from "../lib/geometry";

const PAD = 2600;
const ROAD = 2400;

/** Plan y points up; SVG y points down. */
const P = ([x, y]: Point) => [x, -y] as const;
const pts = (list: Point[]) => list.map((p) => P(p).join(",")).join(" ");

interface Props {
  model: BuildingModel;
  layers: Layers;
  selectedWall: string | null;
  onSelectWall: (id: string | null) => void;
}

export default function PlanView2D({ model, layers, selectedWall, onSelectWall }: Props) {
  const floor = model.floors[0];
  const plot = bbox(model.plot.polygon);
  const sb = model.plot.setbacks;
  const walls = new Map(floor.walls.map((w) => [w.id, w]));
  const road = model.plot.road_sides.map((s) => s[0].toUpperCase() + s.slice(1)).join(", ");
  const viewBox = [plot.x0 - PAD, -(plot.y1 + PAD), plot.w + 2 * PAD, plot.h + 2 * PAD + ROAD].join(" ");

  return (
    <svg viewBox={viewBox} className="h-full w-full select-none" onClick={() => onSelectWall(null)}>
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
      <rect
        x={plot.x0 + sb.left} y={-(plot.y1 - sb.rear)}
        width={plot.w - sb.left - sb.right} height={plot.h - sb.front - sb.rear}
        fill="#fafaf7" stroke="#8a8a96" strokeWidth={25} strokeDasharray="160 110"
      />
      {model.plot.gate && (
        <line x1={model.plot.gate[0]} x2={model.plot.gate[0] + model.plot.gate[1]} y1={-plot.y0} y2={-plot.y0} stroke="#fafaf7" strokeWidth={140} />
      )}
      {[[plot.x0 + 1300, plot.y0 + 1300], [plot.x1 - 1300, plot.y0 + 1300], [plot.x0 + 1300, plot.y1 - 1300], [plot.x1 - 1300, plot.y1 - 1300]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={-y} r={650} fill="#7fb069" opacity={0.9} />
          <circle cx={x - 150} cy={-y - 150} r={330} fill="#97c47f" />
        </g>
      ))}

      {/* Rooms */}
      {floor.rooms.map((r) => (
        <polygon key={r.id} points={pts(r.polygon)} fill={ROOM_COLORS[r.type] ?? "#f4f4f4"} />
      ))}
      {floor.rooms.filter((r) => r.type === "stair").flatMap((r) =>
        stairLayout(r, floor.height).map((t, i) => (
          <rect key={`${r.id}-${i}`} x={t.rect[0]} y={-t.rect[3]} width={t.rect[2] - t.rect[0]} height={t.rect[3] - t.rect[1]}
            fill={t.flight === -1 ? "#e2e2e8" : "#f4f4f7"} stroke="#9a9aa8" strokeWidth={18} />
        )),
      )}

      {layers.furniture && floor.furniture.map((f) => <FurniturePlan key={f.id} f={f} />)}

      {/* Walls */}
      {floor.walls.map((w) =>
        solidSpans(w, floor.openings).map(([s0, s1], i) => (
          <polygon
            key={`${w.id}-${i}`} points={pts(spanRect(w, s0, s1))}
            fill={selectedWall === w.id ? "#6a45f5" : "#2a2833"}
            className="cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onSelectWall(w.id); }}
          />
        )),
      )}

      {/* Openings */}
      {floor.openings.map((o) => {
        const w = walls.get(o.wall)!;
        const h = w.thickness / 2;
        if (o.kind === "window" || o.kind === "ventilator") {
          return (
            <g key={o.id}>
              <polygon points={pts(spanRect(w, o.offset, o.offset + o.width))} fill="#ffffff" stroke="#2a2833" strokeWidth={20} />
              <line {...lineProps(pointOnWall(w, o.offset, 0), pointOnWall(w, o.offset + o.width, 0))} stroke="#4f8fd6" strokeWidth={30} />
            </g>
          );
        }
        if (o.kind === "door") return <DoorSwing key={o.id} w={w} offset={o.offset} width={o.width} side={o.side} h={h} />;
        return null;
      })}

      {/* Labels */}
      {layers.labels && floor.rooms.map((r) => {
        const b = bbox(r.polygon);
        const small = Math.min(b.w, b.h) < 2400;
        return (
          <g key={r.id} pointerEvents="none" textAnchor="middle">
            <text x={b.cx} y={-b.cy - (small ? 60 : 120)} fontSize={small ? 230 : 330} fontWeight={600} fill="#1d1b2e">{r.name}</text>
            <text x={b.cx} y={-b.cy + (small ? 220 : 330)} fontSize={small ? 170 : 240} fill="#55546a">{roomSize(r)}</text>
          </g>
        );
      })}

      {layers.dimensions && (
        <g fill="#3b3a4a" fontSize={300} textAnchor="middle">
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
      )}

      {/* North arrow */}
      <g transform={`translate(${plot.x1 + PAD * 0.45} ${-plot.y1 - PAD * 0.45}) rotate(${model.north_deg})`}>
        <circle r={520} fill="#ffffff" stroke="#3b3a4a" strokeWidth={25} />
        <path d="M0,-430 L190,200 L0,90 L-190,200 Z" fill="#3b3a4a" />
        <text y={-560} textAnchor="middle" fontSize={300} fontWeight={700} fill="#3b3a4a" transform={`rotate(${-model.north_deg} 0 -680)`}>N</text>
      </g>
    </svg>
  );
}

function lineProps(a: Point, b: Point) {
  const [x1, y1] = P(a);
  const [x2, y2] = P(b);
  return { x1, y1, x2, y2 };
}

function DoorSwing({ w, offset, width, side, h }: { w: Wall; offset: number; width: number; side: 1 | -1; h: number }) {
  const H = P(pointOnWall(w, offset, h * side));
  const L = P(pointOnWall(w, offset, (h + width) * side));
  const E = P(pointOnWall(w, offset + width, h * side));
  const cross = (L[0] - H[0]) * (E[1] - H[1]) - (L[1] - H[1]) * (E[0] - H[0]);
  return (
    <g fill="none" stroke="#2a2833">
      <line x1={H[0]} y1={H[1]} x2={L[0]} y2={L[1]} strokeWidth={45} />
      <path d={`M${L[0]},${L[1]} A${width},${width} 0 0 ${cross > 0 ? 1 : 0} ${E[0]},${E[1]}`} strokeWidth={18} strokeDasharray="70 50" />
    </g>
  );
}

function FurniturePlan({ f }: { f: Furniture }) {
  const [w, d] = f.size;
  const [x, y] = P(f.pos);
  const box = (bx: number, by: number, bw: number, bd: number, fill = "#ffffff", rx = 60) => (
    <rect x={bx - bw / 2} y={-(by + bd / 2)} width={bw} height={bd} rx={rx} fill={fill} stroke="#8d8a99" strokeWidth={18} />
  );
  const parts: Record<string, ReactNode> = {
    bed_double: <>{box(0, 0, w, d, "#ffffff")}{box(-w / 4.4, d / 2 - 380, w / 2.6, 420, "#eef0f6")}{box(w / 4.4, d / 2 - 380, w / 2.6, 420, "#eef0f6")}{box(0, -d / 6, w, d * 0.62, "#e4dcf7", 40)}</>,
    sofa: <>{box(0, 0, w, d, "#e8e1d4")}{box(0, -d / 2 + 160, w, 300, "#d8cfbf")}</>,
    car: <>{box(0, 0, w, d, "#ffffff", 600)}{box(0, d * 0.05, w * 0.78, d * 0.42, "#dfe7f1", 300)}</>,
    dining_table: box(0, 0, w, d, "#efe2cc", 120),
    chair: box(0, 0, w, d, "#ffffff", 120),
    wc: <>{box(0, 0, w, d, "#ffffff", 200)}{box(0, d / 2 - 150, w, 260, "#eef0f6", 40)}</>,
  };
  return (
    <g transform={`translate(${x} ${y}) rotate(${-f.rot})`} pointerEvents="none">
      {parts[f.type] ?? box(0, 0, w, d, "#f2f0f6", 30)}
    </g>
  );
}
