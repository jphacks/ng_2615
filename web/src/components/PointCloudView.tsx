// 3D 点群ビュー（仕様書 6章、#22）。
// 深度を 3D の点にして描き、人は 3D の直方体で囲む。地面に 1〜4m の弧と視野の線。ドラッグで回転、ホイールで拡大。
// 30fps で更新するので、three.js の場面は一度だけ作り、点と直方体の位置だけを毎フレーム書き換える。

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DANGER, DEPTH_LUT, SAFE } from "../colors";
import { CAM_HEIGHT, HALF_FOV, fillCloud, personCuboid } from "../geometry";
import { H, W, Z_MAX, type FrameMessage } from "../protocol";

const MAX_PEOPLE = 4; // 直方体とラベルを先に作っておく数
const RINGS = [1, 2, 3, 4]; // 地面の弧 [m]
const HOME = new THREE.Vector3(1.3, 2.3, 1.3); // 最初の視点（センサーの右後ろ上）
const TARGET = new THREE.Vector3(0, 0.5, -2.4);

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  cloud: THREE.BufferGeometry;
  boxes: { edges: THREE.LineSegments; fill: THREE.Mesh }[];
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
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    // ドラッグ中もなめらかに動くように、フレームの届く速さとは別に描き続ける
    s.renderer.setAnimationLoop(() => {
      s.controls.update();
      s.renderer.render(s.scene, s.camera);
    });

    return () => {
      observer.disconnect();
      s.renderer.setAnimationLoop(null);
      s.controls.dispose();
      s.scene.traverse((o) => {
        if (o instanceof THREE.Sprite) {
          o.material.map?.dispose();
          o.material.dispose();
        } else if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
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
    const labels = labelsRef.current;
    if (!s || !labels || !frame) return;

    const positions = s.cloud.getAttribute("position") as THREE.BufferAttribute;
    const colors = s.cloud.getAttribute("color") as THREE.BufferAttribute;
    const n = fillCloud(frame.depth, frame.people, DEPTH_LUT, positions.array as Float32Array, colors.array as Float32Array);
    s.cloud.setDrawRange(0, n);
    positions.needsUpdate = true;
    colors.needsUpdate = true;

    const host = s.renderer.domElement;
    s.boxes.forEach((b, k) => {
      const p = frame.people[k];
      const cuboid = p ? personCuboid(frame.depth, p) : null;
      const label = labels.children[k] as HTMLElement;
      b.edges.visible = b.fill.visible = cuboid !== null;
      if (!p || !cuboid) {
        label.style.display = "none";
        return;
      }
      const size = new THREE.Vector3(...cuboid.max).sub(new THREE.Vector3(...cuboid.min));
      const center = new THREE.Vector3(...cuboid.min).addScaledVector(size, 0.5);
      for (const o of [b.edges, b.fill]) {
        o.position.copy(center);
        o.scale.copy(size);
      }
      (b.edges.material as THREE.LineBasicMaterial).color.set(p.approaching ? DANGER : SAFE);
      b.fill.visible = p.approaching;

      // ラベルは直方体の上に、HTML で重ねる（文字をくっきり出すため）
      const top = new THREE.Vector3(center.x, cuboid.max[1], center.z).project(s.camera);
      const visible = top.z < 1;
      label.style.display = visible ? "" : "none";
      label.style.left = `${((top.x + 1) / 2) * host.clientWidth}px`;
      label.style.top = `${((1 - top.y) / 2) * host.clientHeight}px`;
      label.className = `cloud-label ${p.approaching ? "cloud-label-danger" : ""}`;
      label.textContent = `ID ${p.id}  ${p.dist.toFixed(2)} m`;
    });
  }, [frame]);

  const resetView = () => {
    const s = sceneRef.current;
    if (!s) return;
    s.camera.position.copy(HOME);
    s.controls.target.copy(TARGET);
  };

  return (
    <div ref={hostRef} className="cloud-host">
      <div ref={labelsRef} className="cloud-labels">
        {Array.from({ length: MAX_PEOPLE }, (_, k) => (
          <div key={k} className="cloud-label" style={{ display: "none" }} />
        ))}
      </div>
      <button type="button" className="button cloud-reset" onClick={resetView}>
        視点を戻す
      </button>
      <p className="cloud-hint">ドラッグで回転 · ホイールで拡大</p>
    </div>
  );
}

function createScene(host: HTMLDivElement): Scene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0a0e28);
  renderer.domElement.className = "cloud-canvas";
  host.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 50);
  camera.position.copy(HOME);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enableDamping = true;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.49; // 地面の下には回り込まない

  // 点群（測れた画素だけを前に詰めて、その数だけ描く）
  const cloud = new THREE.BufferGeometry();
  cloud.setAttribute("position", new THREE.BufferAttribute(new Float32Array(W * H * 3), 3).setUsage(THREE.DynamicDrawUsage));
  cloud.setAttribute("color", new THREE.BufferAttribute(new Float32Array(W * H * 3), 3).setUsage(THREE.DynamicDrawUsage));
  cloud.setDrawRange(0, 0);
  const points = new THREE.Points(cloud, new THREE.PointsMaterial({ size: 0.03, vertexColors: true }));
  points.frustumCulled = false; // 点の位置が毎フレーム変わるので、見えない判定をしない
  scene.add(points);

  // 地面：センサーの真下から 1〜4m の弧と、視野の両端の線
  const guide = new THREE.LineBasicMaterial({ color: 0x3a4680, transparent: true, opacity: 0.8 });
  for (const r of RINGS) {
    const arc: THREE.Vector3[] = [];
    for (let k = 0; k <= 32; k++) {
      const a = -HALF_FOV + (2 * HALF_FOV * k) / 32;
      arc.push(new THREE.Vector3(r * Math.sin(a), 0, -r * Math.cos(a)));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), guide));
    scene.add(ringLabel(`${r} m`, r));
  }
  for (const side of [-1, 1]) {
    const end = new THREE.Vector3(side * Z_MAX * Math.sin(HALF_FOV), 0, -Z_MAX * Math.cos(HALF_FOV));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]), guide));
  }

  // センサー（肩の高さの小さな箱）と、地面までの線
  const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0x6c7cff }));
  sensor.position.set(0, CAM_HEIGHT, 0);
  scene.add(sensor);
  scene.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, CAM_HEIGHT, 0)]),
      guide,
    ),
  );

  // 人を囲む直方体（大きさ 1 の箱を、位置と大きさで合わせる）
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const edgesGeometry = new THREE.EdgesGeometry(unit);
  const boxes = Array.from({ length: MAX_PEOPLE }, () => {
    const edges = new THREE.LineSegments(edgesGeometry, new THREE.LineBasicMaterial({ color: SAFE }));
    const fill = new THREE.Mesh(
      unit,
      new THREE.MeshBasicMaterial({ color: DANGER, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    edges.visible = fill.visible = false;
    scene.add(edges, fill);
    return { edges, fill };
  });

  return { renderer, scene, camera, controls, cloud, boxes };
}

// 弧の右端に置く「1 m」などの文字
function ringLabel(text: string, r: number): THREE.Sprite {
  const canvas = Object.assign(document.createElement("canvas"), { width: 128, height: 64 });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8a96c8";
  ctx.font = "600 34px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 32);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false }));
  sprite.scale.set(0.36, 0.18, 1);
  const a = HALF_FOV + 0.08;
  sprite.position.set(r * Math.sin(a) + 0.2, 0.02, -r * Math.cos(a));
  return sprite;
}
