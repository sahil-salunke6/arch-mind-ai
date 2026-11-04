import { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, PerspectiveCamera, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingModel, Floor, Focus, Furniture, Layers, Opening, Point, Room, ViewName, Wall } from "../types";
import { bbox, centroid, footprint, pointOnWall, solidSpans, spanRect, stairLayout, viewDirection, wallFrame } from "../lib/geometry";
import { findRoom, floorBase, stairRise } from "../lib/floors";
import type { CloseUpTarget } from "./CloseUp";

const M = 1 / 1000; // model mm → scene metres

const FLOOR_COLORS: Record<string, string> = {
  bedroom: "#cfa47a", toilet: "#d6e4ec", kitchen: "#e9e0cf", living: "#ece2d2", dining: "#ece2d2",
  stair: "#d4d3d8", parking: "#bdbdc0", foyer: "#e6dccb", puja: "#f0e1b8",
};

interface Props {
  model: BuildingModel;
  layers: Layers;
  view: ViewName;
  mode: "2d" | "3d";
  /** Floor being edited: the cutaway views show it and the floors below. */
  activeFloor?: number;
  selectedWall: string | null;
  onSelectWall: (id: string | null, floor?: number) => void;
  onCanvas?: (canvas: HTMLCanvasElement) => void;
  onThumbnails?: (thumbs: Partial<Record<ViewName, string>>) => void;
  focus?: Focus;
  walking?: boolean;
  onFocus?: (f: Focus) => void;
  onCloseUp?: (t: CloseUpTarget, floor?: number) => void;
}

const EYE = 1600; // mm above the floor

/** Keeps the rest of the app usable when the browser can't start WebGL (GPU off, driver crash). */
class WebGLGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-600">
        <div>
          <p className="font-semibold text-slate-800">The 3D view couldn't start</p>
          <p className="mt-1">This browser has WebGL turned off or its graphics driver stopped. The plan, panels and exports still work.</p>
          <button className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-white" onClick={() => this.setState({ failed: false })}>Try again</button>
        </div>
      </div>
    );
  }
}

export default function Viewer3D(props: Props) {
  return <WebGLGuard><Viewer3DCanvas {...props} /></WebGLGuard>;
}

function Viewer3DCanvas(props: Props) {
  const { model } = props;
  // walking and looking around inside need perspective; the flat 2D camera only suits the 10 views
  const mode = props.walking || props.focus ? "3d" : props.mode;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      onCreated={({ gl }) => props.onCanvas?.(gl.domElement)}
      onPointerMissed={() => { if (!props.walking) props.onSelectWall(null); }}
      style={{ background: "linear-gradient(#eef1f7, #f8f8fb)" }}
    >
      <PerspectiveCamera makeDefault={mode === "3d"} fov={props.walking || props.focus?.kind === "room" ? 70 : props.focus ? 55 : 38} near={0.05} far={500} position={[30, 25, 30]} />
      <OrthographicCamera makeDefault={mode === "2d"} near={-500} far={500} position={[30, 25, 30]} zoom={20} />
      {props.walking ? (
        <Walker model={model} focus={props.focus ?? null} />
      ) : (
        <OrbitControls key={`${mode}-${focusKey(props.focus)}`} makeDefault enableDamping dampingFactor={0.12} zoomSpeed={1.6} zoomToCursor={!props.focus} {...orbitLimits(model, props.focus ?? null)} />
      )}
      {!props.walking && <CameraRig key={mode} model={model} view={props.view} mode={mode} focus={props.focus ?? null} />}
      <Thumbnails model={model} onThumbnails={props.onThumbnails} />
      {import.meta.env.DEV && <DevHook />}

      <hemisphereLight args={["#ffffff", "#c3ccb4", 1.1]} />
      <directionalLight
        castShadow position={[18, 30, 12]} intensity={2.4}
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30}
      />
      <Site {...props} mode={mode} />
    </Canvas>
  );
}

/** Model-space transform: plan (x, y) mm → scene (x, z) metres, centred on the plot. */
function useToScene(model: BuildingModel) {
  return useMemo(() => {
    const p = bbox(model.plot.polygon);
    return ([x, y]: Point, h = 0) => new THREE.Vector3((x - p.cx) * M, h * M, -(y - p.cy) * M);
  }, [model]);
}

function Site({ model, layers, view, selectedWall, onSelectWall, focus, walking, onFocus, onCloseUp, activeFloor = 0 }: Props) {
  const S = useToScene(model);
  const plot = bbox(model.plot.polygon);
  const sb = model.plot.setbacks;
  const fp = footprint(model);
  const top = model.floors.length - 1;
  const showGround = view !== "Bottom";
  const elevation = ["North", "South", "East", "West", "Bottom"].includes(view);
  const cut = layers.cut === "auto" ? (elevation ? "roof" : "open") : layers.cut;
  // inside a room (or walking) you want a ceiling over your head, unless the doll-house cut is chosen
  const inside = walking || focus?.kind === "room";
  const focused = focus?.kind === "room" ? findRoom(model, focus.id) : null;
  const doll = cut === "doll" || layers.cut === "doll";
  // closed views show every storey; cutaways show the floor being worked on and the ones below it
  const lit = Math.min(focused?.floor ?? activeFloor, top);
  const closed = inside ? !doll : cut === "roof";
  const shownTop = closed ? top : lit;
  const showRoof = closed && view !== "Top" && shownTop === top;

  return (
    <group>
      {showGround && (
        <>
          <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[200, 200]} />
            <meshStandardMaterial color="#e3e7dc" />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={S([plot.cx, plot.y0 - 1100 - ((model.plot.road_width ?? 9000) * 0.25)], -10)} receiveShadow>
            <planeGeometry args={[plot.w * M + 30, 4.5]} />
            <meshStandardMaterial color="#8b8d93" />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={S([plot.cx, plot.cy])} receiveShadow>
            <planeGeometry args={[plot.w * M, plot.h * M]} />
            <meshStandardMaterial color="#86b36a" />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={S([plot.cx, plot.y0 + sb.front / 2], 5)} receiveShadow>
            <planeGeometry args={[plot.w * M, sb.front * M]} />
            <meshStandardMaterial color="#d9d4c8" />
          </mesh>
          <CompoundWall model={model} />
          <Trees model={model} />
        </>
      )}

      {/* Plinth */}
      {fp.w > 0 && <Box at={S([fp.cx, fp.cy], model.floors[0].plinth / 2)} size={[fp.w, model.floors[0].plinth, fp.h]} color="#cfc9bd" />}

      {model.floors.slice(0, shownTop + 1).map((floor, i) => (
        <Storey key={i} model={model} index={i} floor={floor}
          wallTop={i === shownTop && doll ? DOLL_HEIGHT : floor.height}
          slab={i < shownTop || showRoof} parapet={i === top && showRoof}
          furniture={layers.furniture}
          selectedWall={i === lit ? selectedWall : null}
          lamp={focused?.floor === i ? focused.room : undefined}
          onSelectWall={walking ? () => {} : (id) => onSelectWall(id, i)}
          onOpenWall={walking ? undefined : (id) => onCloseUp?.({ kind: "wall", id }, i)}
          onRoom={walking ? undefined : (id, shift) => (shift ? onCloseUp?.({ kind: "floor", roomId: id }, i) : onFocus?.({ kind: "room", id }))}
        />
      ))}
    </group>
  );
}

/** One storey: floor finishes, stair, walls, doors and windows, furniture, and the slab above
 * (the next storey's floor, or the roof). */
function Storey({ model, index, floor, wallTop, slab, parapet, furniture, selectedWall, lamp, onSelectWall, onOpenWall, onRoom }: {
  model: BuildingModel; index: number; floor: Floor; wallTop: number; slab: boolean; parapet: boolean; furniture: boolean;
  selectedWall: string | null; lamp?: Room;
  onSelectWall: (id: string) => void; onOpenWall?: (id: string) => void; onRoom?: (id: string, shift: boolean) => void;
}) {
  const S = useToScene(model);
  const base = floorBase(model, index);
  const fp = footprint(model, index);
  const cut = wallTop < floor.height;
  const stairs = floor.rooms.filter((r) => r.type === "stair");
  const below = index > 0 ? model.floors[index - 1].rooms.filter((r) => r.type === "stair").map((r) => r.polygon) : [];
  const hasAbove = index < model.floors.length - 1;
  return (
    <group>
      {/* upstairs, the stair room is open to the flight coming up from below */}
      {floor.rooms.filter((r) => index === 0 || r.type !== "stair").map((r) => (
        <RoomFloor key={r.id} model={model} room={r} base={base} holes={below}
          onDoubleClick={onRoom && (() => onRoom(r.id, false))} onShiftClick={onRoom && (() => onRoom(r.id, true))} />
      ))}
      {lamp && <pointLight position={S(centroid(lamp.polygon), base + floor.height - 300)} intensity={6} distance={12} decay={1.6} color="#fff4e0" />}

      {stairs.flatMap((r) =>
        stairLayout(r, stairRise(floor)).map((t, i) => {
          const [x0, y0, x1, y1] = t.rect;
          return <Box key={`${r.id}-${i}`} at={S([(x0 + x1) / 2, (y0 + y1) / 2], base + t.top / 2)} size={[x1 - x0, t.top, y1 - y0]} color="#dcdad5" />;
        }),
      )}

      {floor.walls.map((w) => (
        <WallMesh key={w.id} model={model} floor={floor} base={base} wall={w} top={wallTop} selected={selectedWall === w.id}
          onSelect={onSelectWall} onOpen={onOpenWall && (() => onOpenWall(w.id))} />
      ))}
      {floor.openings.map((o) => {
        const shown = cut ? clipOpening(o, wallTop) : o;
        return shown.height > 0 && <OpeningMesh key={o.id} model={model} floor={floor} base={base} opening={shown} cut={cut} />;
      })}
      {furniture && floor.furniture.map((f) => <FurnitureMesh key={f.id} model={model} base={base} f={f} />)}

      {slab && fp.w > 0 && (
        <Slab model={model} box={fp} at={base + floor.height} thickness={floor.slab} overhang={hasAbove ? 0 : 150}
          holes={hasAbove ? stairs.map((r) => r.polygon) : []} />
      )}
      {parapet && fp.w > 0 && [
        [[fp.cx, fp.y0 - 100], [fp.w + 300, 150]],
        [[fp.cx, fp.y1 + 100], [fp.w + 300, 150]],
        [[fp.x0 - 100, fp.cy], [150, fp.h + 300]],
        [[fp.x1 + 100, fp.cy], [150, fp.h + 300]],
      ].map(([c, sz], i) => (
        <Box key={i} at={S(c as Point, base + floor.height + floor.slab + model.roof.parapet / 2)}
          size={[(sz as number[])[0], model.roof.parapet, (sz as number[])[1]]} color="#f4f1ea" />
      ))}
    </group>
  );
}

/** A concrete slab over a storey's footprint, with openings cut where the stair goes up. */
function Slab({ model, box, at, thickness, overhang, holes }: {
  model: BuildingModel; box: { x0: number; y0: number; x1: number; y1: number }; at: number; thickness: number; overhang: number; holes: Point[][];
}) {
  const p = bbox(model.plot.polygon);
  const key = JSON.stringify([box.x0, box.y0, box.x1, box.y1, holes, overhang]);
  const geometry = useMemo(() => {
    const v = ([x, y]: Point) => new THREE.Vector2((x - p.cx) * M, (y - p.cy) * M);
    const o = overhang;
    const corners: Point[] = [[box.x0 - o, box.y0 - o], [box.x1 + o, box.y0 - o], [box.x1 + o, box.y1 + o], [box.x0 - o, box.y1 + o]];
    const shape = new THREE.Shape(corners.map(v));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(v)));
    return new THREE.ExtrudeGeometry(shape, { depth: thickness * M, bevelEnabled: false });
  }, [key, thickness, p.cx, p.cy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation-x={-Math.PI / 2} position={[0, at * M, 0]} castShadow receiveShadow>
      <meshStandardMaterial color="#efece6" roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Room floor finish as an extruded polygon, so L-shaped rooms render correctly. */
function RoomFloor({ model, room, base, holes = [], onDoubleClick, onShiftClick }: {
  model: BuildingModel; room: Room; base: number; holes?: Point[][]; onDoubleClick?: () => void; onShiftClick?: () => void;
}) {
  const p = bbox(model.plot.polygon);
  const key = JSON.stringify([room.polygon, holes]);
  const geometry = useMemo(() => {
    const v = ([x, y]: Point) => new THREE.Vector2((x - p.cx) * M, (y - p.cy) * M);
    const shape = new THREE.Shape(room.polygon.map(v));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(v)));
    return new THREE.ExtrudeGeometry(shape, { depth: 20 * M, bevelEnabled: false });
  }, [key, p.cx, p.cy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} rotation-x={-Math.PI / 2} position={[0, base * M, 0]} receiveShadow
      onDoubleClick={(e) => { e.stopPropagation(); if (e.shiftKey) onShiftClick?.(); else onDoubleClick?.(); }}>
      <meshStandardMaterial color={FLOOR_COLORS[room.type] ?? "#e5e0d6"} roughness={0.85} />
    </mesh>
  );
}

function Box({ at, size, color, rotY = 0, ...rest }: {
  at: THREE.Vector3; size: [number, number, number]; color: string; rotY?: number;
  onClick?: (e: { stopPropagation: () => void }) => void; onDoubleClick?: () => void; transparent?: boolean; opacity?: number;
}) {
  return (
    <mesh position={at} rotation-y={rotY} castShadow receiveShadow onClick={rest.onClick}
      onDoubleClick={rest.onDoubleClick && ((e) => { e.stopPropagation(); rest.onDoubleClick!(); })}>
      <boxGeometry args={[size[0] * M, size[1] * M, size[2] * M]} />
      <meshStandardMaterial color={color} transparent={rest.transparent} opacity={rest.opacity ?? 1} roughness={0.85} />
    </mesh>
  );
}

const DOLL_HEIGHT = 1219; // 4 ft

/** Doll-house view: an opening only shows the part below the cut. */
function clipOpening(o: Opening, top: number): Opening {
  return { ...o, height: Math.max(0, Math.min(o.height, top - o.sill)) };
}

function WallMesh({ model, floor, base, wall, top, selected, onSelect, onOpen }: {
  model: BuildingModel; floor: Floor; base: number; wall: Wall; top: number; selected: boolean; onSelect: (id: string) => void; onOpen?: () => void;
}) {
  const S = useToScene(model);
  const { u } = wallFrame(wall);
  const rotY = Math.atan2(u[1], u[0]);
  const H = floor.height;
  const color = selected ? "#8b6cff" : wall.type === "exterior" ? "#f2ede4" : "#faf8f3";

  // [s0, s1, z0, z1] pieces along the wall
  const pieces: [number, number, number, number][] = solidSpans(wall, floor.openings).map(([s0, s1]) => [s0, s1, 0, H]);
  for (const o of floor.openings.filter((o) => o.wall === wall.id)) {
    if (o.sill > 0) pieces.push([o.offset, o.offset + o.width, 0, o.sill]);
    if (o.sill + o.height < H) pieces.push([o.offset, o.offset + o.width, o.sill + o.height, H]);
  }
  const visible = pieces.filter(([, , z0]) => z0 < top).map(([s0, s1, z0, z1]) => [s0, s1, z0, Math.min(z1, top)] as const);
  const click = (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect(wall.id); };
  return (
    <group>
      {visible.map(([s0, s1, z0, z1], i) => (
        <Box key={i} at={S(pointOnWall(wall, (s0 + s1) / 2), base + (z0 + z1) / 2)} size={[s1 - s0, z1 - z0, wall.thickness]}
          rotY={rotY} color={color} onClick={click} onDoubleClick={onOpen} />
      ))}
    </group>
  );
}

function OpeningMesh({ model, floor, base, opening: o, cut = false }: {
  model: BuildingModel; floor: Floor; base: number; opening: Opening; cut?: boolean;
}) {
  const S = useToScene(model);
  const wall = floor.walls.find((w) => w.id === o.wall);
  if (!wall) return null;
  const { u, n } = wallFrame(wall);
  const rotY = Math.atan2(u[1], u[0]);
  const at = (s: number, z: number, k = 0) => S(pointOnWall(wall, s, k), base + z);

  if (o.kind === "window" || o.kind === "ventilator") {
    const mid = o.offset + o.width / 2;
    const zc = o.sill + o.height / 2;
    // vertical mullions per style: casement 1, 3-panel 2, sliding = overlapping sashes, fixed none
    const panes = o.style === "three_panel" ? 3 : o.style === "fixed" ? 1 : 2;
    const louvres = o.style === "louvered" || o.kind === "ventilator";
    const slats = Math.max(2, Math.round(o.height / 120));
    return (
      <group>
        {o.style === "sliding_window" ? (
          <>
            <Box at={at(o.offset + o.width * 0.27, zc, -25)} size={[o.width * 0.55, o.height, 25]} rotY={rotY} color="#9fc8e6" transparent opacity={0.5} />
            <Box at={at(o.offset + o.width * 0.73, zc, 25)} size={[o.width * 0.55, o.height, 25]} rotY={rotY} color="#9fc8e6" transparent opacity={0.5} />
          </>
        ) : (
          <Box at={at(mid, zc)} size={[o.width, o.height, 30]} rotY={rotY} color="#9fc8e6" transparent opacity={0.5} />
        )}
        {!louvres && Array.from({ length: panes - 1 }, (_, i) => (
          <Box key={i} at={at(o.offset + ((i + 1) * o.width) / panes, zc)} size={[45, o.height, 60]} rotY={rotY} color="#5b5d66" />
        ))}
        {louvres && Array.from({ length: slats }, (_, i) => (
          <Box key={i} at={at(mid, o.sill + ((i + 0.5) * o.height) / slats)} size={[o.width, 25, 70]} rotY={rotY} color="#d6d3cc" />
        ))}
        <Box at={at(mid, o.sill - 25)} size={[o.width + 100, 50, wall.thickness + 60]} rotY={rotY} color="#5b5d66" />
        {!cut && <Box at={at(mid, o.sill + o.height + 40)} size={[o.width + 300, 80, wall.thickness + 250]} rotY={rotY} color="#d9d4ca" />}
      </group>
    );
  }

  if (o.kind === "door") {
    const leaf = (hingeS: number, width: number, swingAlong: 1 | -1, glass: boolean, key: string) => {
      const open = (70 * Math.PI) / 180;
      const hinge = pointOnWall(wall, hingeS, (wall.thickness / 2) * o.side);
      const dir: Point = [
        Math.cos(open) * u[0] * swingAlong + Math.sin(open) * n[0] * o.side,
        Math.cos(open) * u[1] * swingAlong + Math.sin(open) * n[1] * o.side,
      ];
      const centre: Point = [hinge[0] + (dir[0] * width) / 2, hinge[1] + (dir[1] * width) / 2];
      return glass ? (
        <Box key={key} at={S(centre, base + o.height / 2)} size={[width, o.height, 30]} rotY={Math.atan2(dir[1], dir[0])} color="#9fc8e6" transparent opacity={0.55} />
      ) : (
        <Box key={key} at={S(centre, base + o.height / 2)} size={[width, o.height, 40]} rotY={Math.atan2(dir[1], dir[0])} color="#8a5a3b" />
      );
    };
    if (o.style === "sliding") {
      return (
        <group>
          <Box at={at(o.offset + o.width * 0.3, o.height / 2, -30)} size={[o.width * 0.55, o.height, 30]} rotY={rotY} color="#9fc8e6" transparent opacity={0.55} />
          <Box at={at(o.offset + o.width * 0.7, o.height / 2, 30)} size={[o.width * 0.55, o.height, 30]} rotY={rotY} color="#9fc8e6" transparent opacity={0.55} />
        </group>
      );
    }
    if (o.style === "double" || o.style === "french") {
      const half = o.width / 2;
      return <group>{leaf(o.offset, half, 1, o.style === "french", "a")}{leaf(o.offset + o.width, half, -1, o.style === "french", "b")}</group>;
    }
    return leaf(o.offset, o.width, 1, false, "a");
  }
  return null;
}

function FurnitureMesh({ model, base: level, f }: { model: BuildingModel; base: number; f: Furniture }) {
  const S = useToScene(model);
  const [w, d, h] = f.size;
  const base = level + 20;
  // local part: (x, y) offset in plan mm, z0 bottom, size, colour
  const part = (x: number, y: number, z0: number, pw: number, pd: number, ph: number, color: string, key: string | number) => (
    <mesh key={key} position={[x * M, (z0 + ph / 2) * M, -y * M]} castShadow receiveShadow>
      <boxGeometry args={[pw * M, ph * M, pd * M]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
  const legs = (top: number, color: string) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => part(sx * (w / 2 - 60), sy * (d / 2 - 60), 0, 50, 50, top, color, `leg${i}`));

  let body: ReactNode;
  switch (f.type) {
    case "bed_single":
    case "bed_double":
      body = [
        part(0, 0, 0, w, d, 300, "#9b7350", 1), part(0, 0, 300, w - 60, d - 60, 220, "#fbfbfd", 2),
        part(0, -d / 6, 520, w - 40, d * 0.6, 40, "#b7a6e8", 3), part(0, d / 2 - 40, 0, w, 80, 1000, "#8a6446", 4),
        part(-w / 4.4, d / 2 - 380, 520, w / 2.6, 380, 120, "#eef0f6", 5), part(w / 4.4, d / 2 - 380, 520, w / 2.6, 380, 120, "#eef0f6", 6),
      ];
      break;
    case "sofa":
      body = [part(0, 0, 0, w, d, 420, "#c9bca6", 1), part(0, -d / 2 + 130, 420, w, 260, 400, "#b9ab93", 2),
        part(-w / 2 + 110, 0, 420, 220, d, 200, "#b9ab93", 3), part(w / 2 - 110, 0, 420, 220, d, 200, "#b9ab93", 4)];
      break;
    case "dining_table":
    case "coffee_table":
      body = [part(0, 0, h - 40, w, d, 40, "#a7774f", "top"), ...legs(h - 40, "#7a5538")];
      break;
    case "chair":
      body = [part(0, 0, 420, w, d, 40, "#a7774f", 1), part(0, 0, 0, w * 0.8, d * 0.8, 420, "#7a5538", 2)];
      break;
    case "kitchen_counter":
      body = [part(0, 0, 0, w, d, h - 40, "#ece6dc", 1), part(0, 0, h - 40, w, d, 40, "#3a3a42", 2)];
      break;
    case "tv_unit":
      body = [part(0, 0, 0, w, d, 450, "#5a4a3e", 1), part(0, 0, 900, w * 0.8, 60, 800, "#16161a", 2)];
      break;
    case "car":
      return (
        <group position={S(f.pos, base)} rotation-y={(f.rot * Math.PI) / 180}>
          <RoundedBox args={[w * M, h * 0.5 * M, d * M]} radius={0.25} position={[0, h * 0.37 * M, 0]} castShadow>
            <meshStandardMaterial color="#f4f5f7" metalness={0.3} roughness={0.35} />
          </RoundedBox>
          <RoundedBox args={[w * 0.82 * M, h * 0.32 * M, d * 0.48 * M]} radius={0.2} position={[0, h * 0.75 * M, -d * 0.03 * M]} castShadow>
            <meshStandardMaterial color="#3d4a5c" metalness={0.5} roughness={0.2} />
          </RoundedBox>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => (
            <mesh key={i} position={[sx * w * 0.46 * M, 0.33, sy * d * 0.32 * M]} rotation-z={Math.PI / 2} castShadow>
              <cylinderGeometry args={[0.33, 0.33, 0.25, 20]} />
              <meshStandardMaterial color="#1c1c20" />
            </mesh>
          ))}
        </group>
      );
    case "wc":
      body = [part(0, -d / 6, 0, w * 0.8, d * 0.7, h * 0.75, "#ffffff", 1), part(0, d / 2 - 120, 0, w, 240, h, "#f3f4f7", 2)];
      break;
    case "wardrobe":
      body = [part(0, 0, 0, w, d, h, "#b48a5f", 1)];
      break;
    default:
      body = [part(0, 0, 0, w, d, h, "#d8d2c8", 1)];
  }
  return (
    <group position={S(f.pos, base)} rotation-y={(f.rot * Math.PI) / 180}>
      {body}
    </group>
  );
}

function CompoundWall({ model }: { model: BuildingModel }) {
  const S = useToScene(model);
  const p = bbox(model.plot.polygon);
  const gate = model.plot.gate;
  const h = 1200, t = 150;
  const runs: [Point, Point][] = [
    [[p.x0, p.y1], [p.x1, p.y1]], [[p.x0, p.y0], [p.x0, p.y1]], [[p.x1, p.y0], [p.x1, p.y1]],
    ...(gate ? [[[p.x0, p.y0], [gate[0], p.y0]], [[gate[0] + gate[1], p.y0], [p.x1, p.y0]]] as [Point, Point][] : [[[p.x0, p.y0], [p.x1, p.y0]]] as [Point, Point][]),
  ];
  return (
    <group>
      {runs.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1).map(([a, b], i) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return <Box key={i} at={S([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h / 2)} size={[len + t, h, t]}
          rotY={Math.atan2(b[1] - a[1], b[0] - a[0])} color="#e7e1d6" />;
      })}
    </group>
  );
}

function Trees({ model }: { model: BuildingModel }) {
  const S = useToScene(model);
  const p = bbox(model.plot.polygon);
  const spots: Point[] = [[p.x0 + 1300, p.y0 + 1300], [p.x1 - 1300, p.y0 + 1300], [p.x0 + 1300, p.y1 - 1300], [p.x1 - 1300, p.y1 - 1300]];
  return (
    <group>
      {spots.map((pt, i) => (
        <group key={i} position={S(pt)}>
          <mesh position={[0, 1, 0]} castShadow><cylinderGeometry args={[0.1, 0.14, 2, 8]} /><meshStandardMaterial color="#7a5a3c" /></mesh>
          <mesh position={[0, 2.6, 0]} castShadow><icosahedronGeometry args={[1.1, 1]} /><meshStandardMaterial color="#5f9a4a" flatShading /></mesh>
          <mesh position={[0.4, 3.2, 0.2]} castShadow><icosahedronGeometry args={[0.7, 1]} /><meshStandardMaterial color="#73b05a" flatShading /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Camera pose for one of the 10 views, relative to the plot centre. */
function viewPose(model: BuildingModel, view: ViewName, mode: "2d" | "3d", aspect = 1.5) {
  const p = bbox(model.plot.polygon);
  // Perspective FOV is vertical, so narrow viewports need the camera further back.
  const D = Math.hypot(p.w, p.h) * M * (mode === "3d" ? 1.25 / Math.min(1, aspect) : 2);
  const storeys = model.floors.length - 1;
  const target = new THREE.Vector3(0, (mode === "3d" ? 1.5 : 2) + storeys * 1.6, 0);
  // a small z offset fixes the azimuth so the plan reads with the road at the bottom
  if (view === "Top") return { pos: new THREE.Vector3(0, D, D * 0.01), target: new THREE.Vector3(0, 0, 0) };
  if (view === "Bottom") return { pos: new THREE.Vector3(0, -D, D * 0.01), target: new THREE.Vector3(0, 0, 0) };
  const [dx, dy] = viewDirection(model, view)!;
  const corner = view.length === 2;
  const elev = mode === "2d" ? (corner ? Math.atan(1 / Math.SQRT2) : 0) : corner ? 0.55 : 0.22;
  const horiz = new THREE.Vector3(dx, 0, -dy).multiplyScalar(D * Math.cos(elev));
  return { pos: horiz.add(new THREE.Vector3(0, D * Math.sin(elev), 0)).add(target), target };
}

function focusKey(f: Focus | undefined) {
  return !f ? "house" : f.kind === "room" ? `room-${f.id}` : "outside";
}

/** Where the camera goes for a focus, and how far it may orbit/zoom without leaving the room. */
function focusPose(model: BuildingModel, focus: Focus) {
  const p = bbox(model.plot.polygon);
  const S = (pt: Point, h: number) => new THREE.Vector3((pt[0] - p.cx) * M, h * M, -(pt[1] - p.cy) * M);
  if (focus?.kind === "room") {
    const found = findRoom(model, focus.id);
    if (found) {
      const { room } = found;
      const level = floorBase(model, found.floor);
      const b = bbox(room.polygon);
      const c = centroid(room.polygon);
      const reach = Math.max(400, 0.42 * Math.min(b.w, b.h)); // stays inside the room while orbiting
      const target = S(c, level + 1300);
      const pos = S([c[0] - reach * 0.7, c[1] - reach * 0.7], level + EYE);
      return { pos, target, maxDistance: reach * M * 1.05 };
    }
  }
  if (focus?.kind === "outside") {
    const target = S([p.cx, p.cy], 1500);
    const pos = S([p.cx, p.y0 - 2500], EYE);
    return { pos, target, maxDistance: Math.hypot(p.w, p.h) * M };
  }
  return null;
}

function orbitLimits(model: BuildingModel, focus: Focus) {
  const pose = focusPose(model, focus);
  if (!pose) return {};
  // inside: look all the way up to the ceiling and down to the floor; outside: stay above ground
  return focus?.kind === "room"
    ? { minDistance: 0.05, maxDistance: pose.maxDistance, minPolarAngle: 0.05, maxPolarAngle: Math.PI - 0.05, enablePan: false }
    : { minDistance: 2, maxDistance: pose.maxDistance, maxPolarAngle: Math.PI / 2 - 0.02 };
}

function CameraRig({ model, view, mode, focus }: { model: BuildingModel; view: ViewName; mode: "2d" | "3d"; focus: Focus }) {
  const { camera, controls, size, invalidate } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    controls: (THREE.EventDispatcher<{ start: object }> & { target: THREE.Vector3; update: () => void }) | null;
    size: { width: number; height: number };
    invalidate: () => void;
  };
  const touched = useRef(false); // has the user dragged/zoomed since the last view was applied?
  const plotKey = JSON.stringify(model.plot.polygon);
  const ready = size.width > 80 && size.height > 80; // the panel is still laying out below this
  const fKey = focusKey(focus);

  // Put the camera on the chosen view at once, in this effect: no reliance on animation frames,
  // which a busy or background tab may deliver late. Runs only when the user picks a view, 2D/3D
  // mode or room focus (or the plot changes), never on autosave or resize, so zoom/rotation stay put.
  useEffect(() => {
    if (!ready || !controls) return;
    const p = bbox(model.plot.polygon);
    const pose = focusPose(model, focus) ?? viewPose(model, view, mode, size.width / size.height);
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width, size.height) / (Math.max(p.w, p.h) * M * 1.1);
      camera.updateProjectionMatrix();
    }
    camera.lookAt(pose.target);
    controls.update();
    invalidate();
    touched.current = false;
  }, [view, mode, fKey, plotKey, ready, camera, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  // when the panel is resized (layout switch, window resize) re-frame the view, unless the user has
  // already moved the camera themselves
  const sizeKey = `${Math.round(size.width / 40)}x${Math.round(size.height / 40)}`;
  useEffect(() => {
    if (!ready || !controls || touched.current) return;
    const p = bbox(model.plot.polygon);
    const pose = focusPose(model, focus) ?? viewPose(model, view, mode, size.width / size.height);
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width, size.height) / (Math.max(p.w, p.h) * M * 1.1);
      camera.updateProjectionMatrix();
    }
    controls.update();
    invalidate();
  }, [sizeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!controls) return;
    const mark = () => { touched.current = true; };
    controls.addEventListener("start", mark);
    return () => controls.removeEventListener("start", mark);
  }, [controls]);
  return null;
}

const FOOT = 180; // mm: how far a step can reach under you

/** Keys held for walking; the on-screen pad adds to the same set. */
export const walkKeys = new Set<string>();

/** First-person walking. Drag the view to look around (no pointer lock needed, so it works in any
 * browser or embedded window); W/↑ forward, S/↓ back, A/D sideways, ←/→ or Q/E to turn, Shift runs.
 * Walls block you; doorways and openings let you through. */
function Walker({ model, focus }: { model: BuildingModel; focus: Focus }) {
  const { camera, gl } = useThree();
  const p = bbox(model.plot.polygon);
  const look = useRef({ yaw: 0, pitch: 0 });

  // per storey: its level, the wall pieces that block you (doorways let you through), the floor area,
  // the stair treads you can climb and the stairwell you can't stand over
  const storeys = useMemo(() => {
    const R = 220;
    const inside = (pt: Point, b: { x0: number; y0: number; x1: number; y1: number }) => pt[0] > b.x0 && pt[0] < b.x1 && pt[1] > b.y0 && pt[1] < b.y1;
    return model.floors.map((floor, i) => {
      const base = floorBase(model, i);
      const walls = floor.walls.flatMap((w) => solidSpans(w, floor.openings.filter((o) => o.kind === "door" || o.kind === "opening"))
        .map(([s0, s1]) => bbox(spanRect(w, s0, s1, -w.thickness / 2 - R, w.thickness / 2 + R))));
      const treads = floor.rooms.filter((r) => r.type === "stair")
        // a tread holds you up while it's under part of your foot, not just under your centre
        .flatMap((r) => stairLayout(r, stairRise(floor)).map((t) => ({ b: { x0: t.rect[0] - FOOT, y0: t.rect[1] - FOOT, x1: t.rect[2] + FOOT, y1: t.rect[3] + FOOT }, h: base + t.top })));
      const well = i > 0 ? model.floors[i - 1].rooms.filter((r) => r.type === "stair").map((r) => bbox(r.polygon)) : [];
      const fp = footprint(model, i);
      return {
        base, walls, treads,
        // standing height of this storey's floor at a point, or null where there is none
        floorAt: (pt: Point) => (inside(pt, fp) && !well.some((b) => inside(pt, b)) ? base : null),
        inside,
      };
    });
  }, [model]);

  /** Highest surface under you that you can step onto (up to one tread-and-a-bit above your feet). */
  const groundAt = (pt: Point, feet: number) => {
    let best = 0;
    for (const st of storeys) {
      const f = st.floorAt(pt);
      if (f !== null && f <= feet + 500 && f > best) best = f;
      for (const t of st.treads) if (t.h <= feet + 500 && t.h > best && st.inside(pt, t.b)) best = t.h;
    }
    return best;
  };
  /** The storey you're on: the highest whose floor is at or below your feet. */
  const storeyAt = (feet: number) => {
    let i = 0;
    storeys.forEach((st, j) => { if (st.base <= feet + 300) i = j; });
    return storeys[i];
  };
  const blocked = (x: number, y: number, feet: number) =>
    x < p.x0 + 200 || x > p.x1 - 200 || y < p.y0 - 6000 || y > p.y1 - 200 ||
    (storeyAt(feet)?.walls ?? []).some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1);

  // starting place: inside the chosen room, or 1.5 m in front of the main door facing it
  useEffect(() => {
    const ground = model.floors[0];
    const found = focus?.kind === "room" ? findRoom(model, focus.id) : null;
    const walls = new Map(ground.walls.map((w) => [w.id, w]));
    const mainDoor = ground.openings
      .filter((o) => o.kind === "door" && walls.get(o.wall)?.type === "exterior")
      .map((o) => pointOnWall(walls.get(o.wall)!, o.offset + o.width / 2))
      .sort((a, b) => a[1] - b[1])[0];
    const start: Point = found ? centroid(found.room.polygon) : mainDoor ? [mainDoor[0], mainDoor[1] - 1500] : [p.cx, p.y0 + 1200];
    const target: Point = found ? [p.cx, p.cy] : mainDoor ?? [p.cx, p.cy];
    const eye = (found ? floorBase(model, found.floor) : 0) + EYE;
    camera.position.set((start[0] - p.cx) * M, eye * M, -(start[1] - p.cy) * M);
    // yaw from the direction to the target (scene x, z)
    const dx = (target[0] - start[0]), dz = -(target[1] - start[1]);
    look.current = { yaw: Math.atan2(-dx, -dz), pitch: 0 };
    camera.rotation.set(0, look.current.yaw, 0, "YXZ");
  }, [focusKey(focus), camera]); // eslint-disable-line react-hooks/exhaustive-deps -- camera: walking may switch from the 2D camera

  // keyboard (ignored while typing in a field) and drag-to-look
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof Element && !!e.target.closest("input, textarea, select");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      walkKeys.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault(); // don't scroll the page
    };
    const up = (e: KeyboardEvent) => walkKeys.delete(e.code);
    const blur = () => walkKeys.clear();
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      look.current.yaw -= (e.clientX - drag.x) * 0.005;
      look.current.pitch = Math.max(-1.3, Math.min(1.3, look.current.pitch - (e.clientY - drag.y) * 0.005));
      drag = { x: e.clientX, y: e.clientY };
    };
    const pu = () => { drag = null; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.style.cursor = "grab";
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.style.cursor = "";
      walkKeys.clear();
    };
  }, [gl]);

  useFrame((_, dt) => {
    const k = walkKeys;
    const t = Math.min(dt, 0.1);
    const turn = (k.has("ArrowLeft") || k.has("KeyQ") ? 1 : 0) - (k.has("ArrowRight") || k.has("KeyE") ? 1 : 0);
    look.current.yaw += turn * 1.8 * t;
    camera.rotation.set(look.current.pitch, look.current.yaw, 0, "YXZ");

    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const side = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    if (fwd || side) {
      const yaw = look.current.yaw;
      const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const speed = (k.has("ShiftLeft") || k.has("ShiftRight") ? 3 : 1.4) * t;
      const move = dir.multiplyScalar(fwd * speed).add(right.multiplyScalar(side * speed));
      // plan coordinates of where we are and where we'd go; slide along walls axis by axis
      const feet = camera.position.y / M - EYE;
      const x = camera.position.x / M + p.cx, y = -camera.position.z / M + p.cy;
      if (!blocked(x + move.x / M, y, feet)) camera.position.x += move.x;
      if (!blocked(camera.position.x / M + p.cx, y - move.z / M, feet)) camera.position.z += move.z;
    }
    // follow the ground: plinth, stair treads, upper floors (and drop down a stairwell)
    const feet = camera.position.y / M - EYE;
    const g = groundAt([camera.position.x / M + p.cx, -camera.position.z / M + p.cy], feet);
    camera.position.y += ((g + EYE) * M - camera.position.y) * Math.min(1, t * 10);
  });

  return null;
}

/** Development only: lets automated browser checks read the live camera (window.__view). */
function DevHook() {
  const { camera, controls, invalidate } = useThree();
  useEffect(() => {
    (window as unknown as { __view: unknown }).__view = { camera, controls, invalidate };
  });
  return null;
}

/** Render a small snapshot of every view once the scene has settled. */
function Thumbnails({ model, onThumbnails }: { model: BuildingModel; onThumbnails?: Props["onThumbnails"] }) {
  const { gl, scene } = useThree();
  const frames = useRef(0);
  const done = useRef<BuildingModel | null>(null);
  useEffect(() => { frames.current = 0; }, [model]);
  useFrame(() => {
    if (!onThumbnails || done.current === model || ++frames.current < 20) return;
    done.current = model;
    const src = gl.domElement;
    const out: Partial<Record<ViewName, string>> = {};
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 110;
    const ctx = canvas.getContext("2d")!;
    const aspect = src.width / src.height;
    const cam = new THREE.PerspectiveCamera(38, aspect, 0.1, 500);
    const crop = 160 / 110;
    const VIEWS: ViewName[] = ["North", "South", "East", "West", "NE", "NW", "SE", "SW", "Top", "Bottom"];
    for (const v of VIEWS) {
      const { pos, target } = viewPose(model, v, "3d", Math.min(aspect, crop));
      cam.position.copy(pos);
      cam.lookAt(target);
      gl.render(scene, cam);
      // centre crop of the live canvas at the thumbnail's aspect ratio
      const cw = Math.min(src.width, src.height * crop), ch = cw / crop;
      ctx.drawImage(src, (src.width - cw) / 2, (src.height - ch) / 2, cw, ch, 0, 0, 160, 110);
      out[v] = canvas.toDataURL("image/jpeg", 0.85);
    }
    onThumbnails(out);
  });
  return null;
}

