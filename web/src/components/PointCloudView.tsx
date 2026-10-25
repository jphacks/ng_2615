// 3D 点群ビュー（仕様書 6章、#22）。
// 自分（装着者）を中心にしたレーダーのような画面。自分の頭の上から、背中越しに後ろを見下ろす。
// 地面には自分を中心に 1〜4m の輪、センサーの視野（扇形）、警告が始まる 3.5m の線。人は 3D の直方体で囲み、足元も描く。
// 視点は固定（回さない）。描くのはフレームが届いたときだけなので軽く、発表でも誰が見ても同じ見え方になる。
// 深度はノイズを取って間引き、つながった面にして描く（surface.ts）。
// three.js の場面は一度だけ作り、面と直方体の位置だけを毎フレーム書き換える。

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DANGER, DEPTH_LUT, SAFE } from "../colors";
import { HALF_FOV, personCuboid } from "../geometry";
import { Z_MAX, type FrameMessage } from "../protocol";
import { GH, GW, SurfaceBuilder } from "../surface";

const MAX_PEOPLE = 4; // 直方体とラベルを先に作っておく数
const RINGS = [1, 2, 3, 4]; // 自分を中心にした輪 [m]
const WARN_DIST = 3.5; // 警告が始まる距離 [m]（pi/track.py と同じ）
const EYE = new THREE.Vector3(0, 2.4, 0.5); // 視点：自分の頭の上（後ろの範囲が画面いっぱいに入るように）
const TARGET = new THREE.Vector3(0, 0.5, -2.3); // 見る先：背中越しに後ろ
const BG = 0x060914;
const ACCENT = 0x5b8cff;

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  surface: THREE.BufferGeometry;
  builder: SurfaceBuilder;
  boxes: { edges: THREE.LineSegments; fill: THREE.Mesh; foot: THREE.Mesh }[];
}

export function PointCloudView({ frame }: { frame: FrameMessage | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const ringLabelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const ringLabels = ringLabelsRef.current;
    if (!host || !ringLabels) return;
    const s = createScene(host);
    sceneRef.current = s;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      s.renderer.setSize(w, h, false);
      s.camera.aspect = w / Math.max(1, h);
      s.camera.updateProjectionMatrix();
      // 輪の「1 m」などの文字は、視点が動かないので大きさが変わったときだけ置き直す
      RINGS.forEach((r, k) => {
        const a = HALF_FOV + 0.05; // 視野の扇形の右外（点群に重ならないように）
        place(ringLabels.children[k] as HTMLElement, new THREE.Vector3(r * Math.sin(a), 0, -r * Math.cos(a)), s.camera, host);
      });
      s.renderer.render(s.scene, s.camera);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      observer.disconnect();
      s.scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        }
      });
      s.renderer.dispose();
      s.renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const s = sceneRef.current;
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!s || !host || !labels || !frame) return;

    const positions = s.surface.getAttribute("position") as THREE.BufferAttribute;
    const colors = s.surface.getAttribute("color") as THREE.BufferAttribute;
    const index = s.surface.getIndex()!;
    const n = s.builder.build(
      frame.depth,
      frame.people,
      DEPTH_LUT,
      positions.array as Float32Array,
      colors.array as Float32Array,
      index.array as Uint32Array,
    );
    s.surface.setDrawRange(0, n);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    index.needsUpdate = true;

    s.boxes.forEach((b, k) => {
      const p = frame.people[k];
      const label = labels.children[k] as HTMLElement;
      b.edges.visible = b.fill.visible = b.foot.visible = p !== undefined;
      if (!p) {
        label.style.display = "none";
        return;
      }
      const { min, max } = personCuboid(p);
      const size = new THREE.Vector3(...max).sub(new THREE.Vector3(...min));
      const center = new THREE.Vector3(...min).addScaledVector(size, 0.5);
      for (const o of [b.edges, b.fill]) {
        o.position.copy(center);
        o.scale.copy(size);
      }
      b.foot.position.set(center.x, 0.005, center.z);
      b.foot.scale.set(size.x, size.z, 1);
      const color = p.approaching ? DANGER : SAFE;
      (b.edges.material as THREE.LineBasicMaterial).color.set(color);
      const fill = b.fill.material as THREE.MeshBasicMaterial;
      fill.color.set(color);
      fill.opacity = p.approaching ? 0.22 : 0.08;
      (b.foot.material as THREE.MeshBasicMaterial).color.set(color);

      // ラベルは直方体の上に、HTML で重ねる（文字をくっきり出すため）
      place(label, new THREE.Vector3(center.x, max[1], center.z), s.camera, host);
      label.className = `cloud-label ${p.approaching ? "cloud-label-danger" : ""}`;
      label.textContent = `ID ${p.id}  ${p.dist.toFixed(2)} m`;
    });
    s.renderer.render(s.scene, s.camera);
  }, [frame]);

  return (
    <div ref={hostRef} className="cloud-host">
      <div ref={ringLabelsRef} className="cloud-labels">
        {RINGS.map((r) => (
          <div key={r} className="cloud-ring-label">
            {r} m
          </div>
        ))}
      </div>
      <div ref={labelsRef} className="cloud-labels">
        {Array.from({ length: MAX_PEOPLE }, (_, k) => (
          <div key={k} className="cloud-label" style={{ display: "none" }} />
        ))}
      </div>
    </div>
  );
}

// 3D の点 at に HTML の文字を置く（画面の外や後ろなら隠す）
function place(el: HTMLElement, at: THREE.Vector3, camera: THREE.Camera, host: HTMLElement) {
  const v = at.clone().project(camera);
  el.style.display = v.z < 1 ? "" : "none";
  el.style.left = `${((v.x + 1) / 2) * host.clientWidth}px`;
  el.style.top = `${((1 - v.y) / 2) * host.clientHeight}px`;
}

// 地面に寝かせた扇形（自分を中心に、後ろ向き ±HALF_FOV）
function sector(inner: number, outer: number, color: THREE.ColorRepresentation, opacity: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(inner, outer, 48, 1, Math.PI / 2 - HALF_FOV, 2 * HALF_FOV);
  geometry.rotateX(-Math.PI / 2); // xy 平面 → 地面（後ろが -z）
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  mesh.position.y = 0.002;
  return mesh;
}

// 地面の円弧（自分を中心に、角度 from〜to。0 が真後ろ）
function arc(r: number, from: number, to: number, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.Line {
  const points: THREE.Vector3[] = [];
  const steps = Math.max(8, Math.round(((to - from) / Math.PI) * 64));
  for (let k = 0; k <= steps; k++) {
    const a = from + ((to - from) * k) / steps;
    points.push(new THREE.Vector3(r * Math.sin(a), 0.004, -r * Math.cos(a)));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  line.computeLineDistances(); // 点線にするとき用
  return line;
}

function createScene(host: HTMLDivElement): Scene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BG);
  renderer.domElement.className = "cloud-canvas";
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 4.5, 9); // 遠くほど暗く（奥行きが分かるように）
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.05, 30);
  camera.position.copy(EYE);
  camera.lookAt(TARGET);

  // 地面：センサーの視野（扇形）と、警告が始まる 3.5m までの範囲
  scene.add(sector(0.3, Z_MAX, ACCENT, 0.07));
  scene.add(sector(0.3, WARN_DIST, DANGER, 0.04));

  // 自分を中心にした輪。視野の外は薄く、視野の中ははっきり
  const faint = new THREE.LineBasicMaterial({ color: 0x1a2348 });
  const bright = new THREE.LineBasicMaterial({ color: 0x34437e });
  for (const r of RINGS) {
    scene.add(arc(r, HALF_FOV, 2 * Math.PI - HALF_FOV, faint));
    scene.add(arc(r, -HALF_FOV, HALF_FOV, bright));
  }
  scene.add(arc(WARN_DIST, -HALF_FOV, HALF_FOV, new THREE.LineDashedMaterial({ color: DANGER, dashSize: 0.12, gapSize: 0.08 })));
  for (const side of [-1, 1]) {
    const end = new THREE.Vector3(side * Z_MAX * Math.sin(HALF_FOV), 0.004, -Z_MAX * Math.cos(HALF_FOV));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.004, 0), end]), bright));
  }

  // 深度の面（間引いた格子の点を、つながるところだけ三角形で結ぶ。三角形の数は毎フレーム変わる）
  const surface = new THREE.BufferGeometry();
  surface.setAttribute("position", new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3).setUsage(THREE.DynamicDrawUsage));
  surface.setAttribute("color", new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3).setUsage(THREE.DynamicDrawUsage));
  surface.setIndex(new THREE.BufferAttribute(new Uint32Array((GW - 1) * (GH - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage));
  surface.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(surface, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false; // 形が毎フレーム変わるので、見えない判定をしない
  scene.add(mesh);

  // 人を囲む直方体（大きさ 1 の箱を、位置と大きさで合わせる）と、足元の長方形
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const edgesGeometry = new THREE.EdgesGeometry(unit);
  const footGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const boxes = Array.from({ length: MAX_PEOPLE }, () => {
    const edges = new THREE.LineSegments(edgesGeometry, new THREE.LineBasicMaterial({ color: SAFE }));
    const fill = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    const foot = new THREE.Mesh(footGeometry, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }));
    edges.visible = fill.visible = foot.visible = false;
    scene.add(foot, fill, edges);
    return { edges, fill, foot };
  });

  return { renderer, scene, camera, surface, builder: new SurfaceBuilder(), boxes };
}
