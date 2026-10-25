// 3D 点群ビュー（仕様書 6章、#22）。
// 自分（装着者）を中心にしたレーダーのような画面。自分の頭の上から、背中越しに後ろを見下ろす。
// 地面には自分を中心に 1〜4m の薄い同心円（距離感が分かるように）。人は円柱で囲む。
// 円柱は、見えている人の点をそのまま囲む（点が少なければ YOLO の枠から作る）。震えないように、前のフレームと少し混ぜる。
// 視点は固定（回さない）。描くのはフレームが届いたときだけなので軽く、発表でも誰が見ても同じ見え方になる。
// 深度はノイズを取って間引き、密度に上限を付けて（一辺 4cm の箱に 1 点）、縁をぼかした点で描く（cloud.ts）。
// 点群らしさは残しつつ、近くで密集した点が粒々（集合体）に見えないようにする。点の数に上限があるので、近づいても重くならない。
// three.js の場面は一度だけ作り、点と円柱の位置だけを毎フレーム書き換える。

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DANGER, DEPTH_LUT, SAFE } from "../colors";
import { personCylinder, type Cylinder } from "../geometry";
import type { FrameMessage } from "../protocol";
import { CloudBuilder, GH, GW, VOXEL } from "../cloud";

const MAX_PEOPLE = 4; // 円柱とラベルを先に作っておく数
const RINGS = [1, 2, 3, 4]; // 自分を中心にした同心円 [m]
const EYE = new THREE.Vector3(0, 2.4, 0.5); // 視点：自分の頭の上（後ろの範囲が画面いっぱいに入るように）
const TARGET = new THREE.Vector3(0, 0.5, -2.3); // 見る先：背中越しに後ろ
const BG = 0x070b17; // styles.css の .view-frame と同じ
const BOX_BLEND = 0.6; // 円柱を前のフレームと混ぜる割合（大きいほど今のフレーム）
const POINT_SIZE = VOXEL * 1.1; // 点の大きさ [m]。密度の上限の箱と同じくらいで、となりと少し触れる（重ねすぎると点群らしさがなくなる）

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cloud: THREE.BufferGeometry;
  builder: CloudBuilder;
  smoothed: Map<number, Cylinder>; // 人ごとの、ならした円柱
  boxes: { edges: THREE.LineSegments; fill: THREE.Mesh }[]; // 人を囲む円柱
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
      b.edges.visible = b.fill.visible = p !== undefined;
      if (!p) {
        label.style.display = "none";
        return;
      }
      const c = smooth(s.smoothed, p.id, s.builder.personCylinder(p) ?? personCylinder(p));
      for (const o of [b.edges, b.fill]) {
        o.position.set(c.x, c.bottom, c.z);
        o.scale.set(c.r, c.top - c.bottom, c.r);
      }
      const color = p.approaching ? DANGER : SAFE;
      (b.edges.material as THREE.LineBasicMaterial).color.set(color);
      const fill = b.fill.material as THREE.MeshBasicMaterial;
      fill.color.set(color);
      fill.opacity = p.approaching ? 0.22 : 0.08;

      // ラベルは円柱の上に、HTML で重ねる（文字をくっきり出すため）
      place(label, new THREE.Vector3(c.x, c.top, c.z), s.camera, host);
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

// 人ごとに、前のフレームの円柱と混ぜる
function smooth(store: Map<number, Cylinder>, id: number, now: Cylinder): Cylinder {
  const prev = store.get(id);
  const mix = (a: number, b: number) => a + (b - a) * BOX_BLEND;
  const out = prev
    ? { x: mix(prev.x, now.x), z: mix(prev.z, now.z), r: mix(prev.r, now.r), bottom: mix(prev.bottom, now.bottom), top: mix(prev.top, now.top) }
    : now;
  store.set(id, out);
  return out;
}

// 半径 1・高さ 1 の円柱の線：上下の円と、縦の線（下が y = 0）
function cylinderLines(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const SEG = 48;
  for (let k = 0; k < SEG; k++) {
    const a0 = (2 * Math.PI * k) / SEG;
    const a1 = (2 * Math.PI * (k + 1)) / SEG;
    for (const y of [0, 1]) points.push(new THREE.Vector3(Math.cos(a0), y, Math.sin(a0)), new THREE.Vector3(Math.cos(a1), y, Math.sin(a1)));
  }
  for (let k = 0; k < 8; k++) {
    const a = (2 * Math.PI * k) / 8;
    points.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), new THREE.Vector3(Math.cos(a), 1, Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
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
  const ring = new THREE.LineBasicMaterial({ color: 0x3a4670 });
  for (const r of RINGS) scene.add(arc(r, 0, 2 * Math.PI, ring));

  // 点群（残った点を前に詰めて、その数だけ描く）
  const cloud = new THREE.BufferGeometry();
  cloud.setAttribute("position", new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3).setUsage(THREE.DynamicDrawUsage));
  cloud.setAttribute("color", new THREE.BufferAttribute(new Float32Array(GW * GH * 3), 3).setUsage(THREE.DynamicDrawUsage));
  cloud.setDrawRange(0, 0);
  const points = new THREE.Points(cloud, pointMaterial());
  points.frustumCulled = false; // 点の位置が毎フレーム変わるので、見えない判定をしない
  scene.add(points);

  // 人を囲む円柱（半径 1・高さ 1 の円柱を、位置と大きさで合わせる）
  const unit = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0);
  const edgesGeometry = cylinderLines();
  const boxes = Array.from({ length: MAX_PEOPLE }, () => {
    const edges = new THREE.LineSegments(edgesGeometry, new THREE.LineBasicMaterial({ color: SAFE }));
    const fill = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    edges.visible = fill.visible = false;
    scene.add(fill, edges);
    return { edges, fill };
  });

  return { renderer, scene, camera, cloud, builder: new CloudBuilder(), smoothed: new Map(), boxes };
}

// ぼかした点。大きさは 3D の中で POINT_SIZE。重ねて描くので、奥行きの書き込みはしない
function pointMaterial(): THREE.PointsMaterial {
  return new THREE.PointsMaterial({
    size: POINT_SIZE,
    vertexColors: true,
    map: dotTexture(),
    transparent: true,
    depthWrite: false,
  });
}

// 点の形：中は同じ明るさで、縁だけふわっと透明になる円（縁をくっきりさせず、泡のような立体感も付けない）
function dotTexture(): THREE.Texture {
  const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255, 255, 255, 1)");
  g.addColorStop(0.6, "rgba(255, 255, 255, 1)");
  g.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
