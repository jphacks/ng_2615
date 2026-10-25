// 3D 点群ビュー（仕様書 6章、#22）。
// 自分（装着者）を中心にしたレーダーのような画面。自分の頭の上から、背中越しに後ろを見下ろす。
// 地面には自分を中心に 1〜4m の薄い同心円（距離感が分かるように）。人は 3D の直方体で囲み、足元も描く。
// 直方体は、人の点群の広がりに合わせる（点が少なければ YOLO の枠から作る）。震えないように、前のフレームと混ぜる。
// 視点は固定（回さない）。描くのはフレームが届いたときだけなので軽く、発表でも誰が見ても同じ見え方になる。
// 深度はノイズを取って間引き、丸い点の点群で描く（cloud.ts）。
// three.js の場面は一度だけ作り、点と直方体の位置だけを毎フレーム書き換える。

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DANGER, DEPTH_LUT, SAFE } from "../colors";
import { personCuboid, type Cuboid } from "../geometry";
import type { FrameMessage } from "../protocol";
import { CloudBuilder, GH, GW } from "../cloud";

const MAX_PEOPLE = 4; // 直方体とラベルを先に作っておく数
const RINGS = [1, 2, 3, 4]; // 自分を中心にした同心円 [m]
const EYE = new THREE.Vector3(0, 2.4, 0.5); // 視点：自分の頭の上（後ろの範囲が画面いっぱいに入るように）
const TARGET = new THREE.Vector3(0, 0.5, -2.3); // 見る先：背中越しに後ろ
const BG = 0x060914;
const BOX_BLEND = 0.35; // 直方体を前のフレームと混ぜる割合（大きいほど今のフレーム）

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cloud: THREE.BufferGeometry;
  builder: CloudBuilder;
  smoothed: Map<number, Cuboid>; // 人ごとの、ならした直方体
  boxes: { edges: THREE.LineSegments; fill: THREE.Mesh; foot: THREE.Mesh }[];
}

export function PointCloudView({ frame }: { frame: FrameMessage | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = createScene(host);
    sceneRef.current = s;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      s.renderer.setSize(w, h, false);
      s.camera.aspect = w / Math.max(1, h);
      s.camera.updateProjectionMatrix();
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
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m instanceof THREE.PointsMaterial) m.map?.dispose();
            m.dispose();
          });
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

    const positions = s.cloud.getAttribute("position") as THREE.BufferAttribute;
    const colors = s.cloud.getAttribute("color") as THREE.BufferAttribute;
    const n = s.builder.build(frame.depth, frame.people, DEPTH_LUT, positions.array as Float32Array, colors.array as Float32Array);
    s.cloud.setDrawRange(0, n);
    positions.needsUpdate = true;
    colors.needsUpdate = true;

    const ids = new Set(frame.people.map((p) => p.id));
    for (const id of s.smoothed.keys()) if (!ids.has(id)) s.smoothed.delete(id);
    s.boxes.forEach((b, k) => {
      const p = frame.people[k];
      const label = labels.children[k] as HTMLElement;
      b.edges.visible = b.fill.visible = b.foot.visible = p !== undefined;
      if (!p) {
        label.style.display = "none";
        return;
      }
      const { min, max } = smooth(s.smoothed, p.id, s.builder.personCuboid(p) ?? personCuboid(p));
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
      <div ref={labelsRef} className="cloud-labels">
        {Array.from({ length: MAX_PEOPLE }, (_, k) => (
          <div key={k} className="cloud-label" style={{ display: "none" }} />
        ))}
      </div>
    </div>
  );
}

// 人ごとに、前のフレームの直方体と混ぜる
function smooth(store: Map<number, Cuboid>, id: number, now: Cuboid): Cuboid {
  const prev = store.get(id);
  const mix = (a: number[], b: number[]) => a.map((v, k) => v + (b[k] - v) * BOX_BLEND) as Cuboid["min"];
  const out = prev ? { min: mix(prev.min, now.min), max: mix(prev.max, now.max) } : now;
  store.set(id, out);
  return out;
}

// 3D の点 at に HTML の文字を置く（画面の外や後ろなら隠す）
function place(el: HTMLElement, at: THREE.Vector3, camera: THREE.Camera, host: HTMLElement) {
  const v = at.clone().project(camera);
  el.style.display = v.z < 1 ? "" : "none";
  el.style.left = `${((v.x + 1) / 2) * host.clientWidth}px`;
  el.style.top = `${((1 - v.y) / 2) * host.clientHeight}px`;
}

// 地面の円弧（自分を中心に、角度 from〜to。0 が真後ろ）
function arc(r: number, from: number, to: number, material: THREE.LineBasicMaterial): THREE.Line {
  const points: THREE.Vector3[] = [];
  const steps = Math.max(8, Math.round(((to - from) / Math.PI) * 64));
  for (let k = 0; k <= steps; k++) {
    const a = from + ((to - from) * k) / steps;
    points.push(new THREE.Vector3(r * Math.sin(a), 0.004, -r * Math.cos(a)));
  }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
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

  // 地面：自分を中心にした薄い同心円
  const ring = new THREE.LineBasicMaterial({ color: 0x26315e });
  for (const r of RINGS) scene.add(arc(r, 0, 2 * Math.PI, ring));

  // 点群（残った点を前に詰めて、その数だけ描く）。点は丸く（四角い点より点群らしく、やわらかく見える）
  const cloud = new THREE.BufferGeometry();
  cloud.setAttribute("position", new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3).setUsage(THREE.DynamicDrawUsage));
  cloud.setAttribute("color", new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3).setUsage(THREE.DynamicDrawUsage));
  cloud.setDrawRange(0, 0);
  const points = new THREE.Points(
    cloud,
    new THREE.PointsMaterial({ size: 0.03, vertexColors: true, map: dotTexture(), alphaTest: 0.5 }),
  );
  points.frustumCulled = false; // 点の位置が毎フレーム変わるので、見えない判定をしない
  scene.add(points);

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

  return { renderer, scene, camera, cloud, builder: new CloudBuilder(), smoothed: new Map(), boxes };
}

// 丸い点の形（白い円）
function dotTexture(): THREE.Texture {
  const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, 2 * Math.PI);
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}
