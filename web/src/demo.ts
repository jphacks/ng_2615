// Pi につながらないときのデモデータ。protocol.ts の FrameMessage と同じ形で返す。
// 流れは pi/fake_sensor.py と同じ（仕様書 7章の完了条件）：ついてくる → 近づく → 止まって遠ざかる。
// Pi がいないので、接近の判定もここでする（本物はブラウザでは判定しない）。

import { H, W, metersToU8, type FrameMessage, type Person } from "./protocol";

const FPS = 25;
const FX = 171; // 焦点距離 [px]
const CAM_HEIGHT = 1.4; // 肩の高さ [m]
const TILT = (10 * Math.PI) / 180; // 下向きの角度
const MIN_SPEED = 0.3; // 接近判定 [m/s]（仕様書 5章）
const MAX_TTC = 3.0; // [s]

// [秒, 始めの距離, 終わりの距離]、null はいない
const SCENARIO: [number, number | null, number | null][] = [
  [4.0, 3.5, 3.5], // 1. 同じ速さでついてくる → 白
  [3.0, 3.5, 1.1], // 2. 早足で追いつく → 赤
  [2.7, 1.1, 4.3], // 3. 止まる（装着者が歩くので遠ざかる）→ 白
  [2.3, null, null], // 見えなくなる
];
const LENGTH = SCENARIO.reduce((sum, [d]) => sum + d, 0);

function distanceAt(t: number): { z: number | null; speed: number } {
  let rest = t % LENGTH;
  for (const [duration, z0, z1] of SCENARIO) {
    if (rest < duration) {
      if (z0 === null || z1 === null) return { z: null, speed: 0 };
      return { z: z0 + ((z1 - z0) * rest) / duration, speed: -(z1 - z0) / duration };
    }
    rest -= duration;
  }
  return { z: null, speed: 0 };
}

// 地面からの高さ height [m]、距離 z [m] の点が写る行
function rowOf(height: number, z: number): number {
  return H / 2 + FX * Math.tan(Math.atan2(CAM_HEIGHT - height, z) - TILT);
}

// 地面だけのときの深度（行ごとに同じ）
const ground = Array.from({ length: H }, (_, y) => {
  const angle = TILT + Math.atan((y - H / 2) / FX);
  return angle > 0 ? metersToU8(CAM_HEIGHT / Math.sin(angle)) : 0;
});

// 時刻 t [s] のデモフレーム（テストでも使う）
export function makeDemoFrame(seq: number, t: number): FrameMessage {
  const depth = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) depth.fill(ground[y], y * W, (y + 1) * W);

  const people: Person[] = [];
  const { z, speed } = distanceAt(t);
  if (z !== null && z <= 4.0) {
    const x = 0.15 * Math.sin(t * 0.8);
    const halfWidth = 0.225;
    const x0 = Math.max(0, Math.floor(W / 2 + (FX * (x - halfWidth)) / z));
    const x1 = Math.min(W, Math.ceil(W / 2 + (FX * (x + halfWidth)) / z));
    const y0 = Math.max(0, Math.floor(rowOf(1.7, z)));
    const y1 = Math.min(H, Math.ceil(rowOf(0, z)));
    const b = metersToU8(z);
    for (let y = y0; y < y1; y++) depth.fill(b, y * W + x0, y * W + x1);

    const ttc = speed > 0 ? z / speed : null;
    people.push({
      id: 1 + Math.floor(t / LENGTH), // 一周ごとに新しい人
      box: [x0, y0, x1 - x0, y1 - y0],
      dist: z,
      speed,
      ttc,
      approaching: speed >= MIN_SPEED && ttc !== null && ttc <= MAX_TTC,
    });
  }
  return { seq, t: Date.now(), w: W, h: H, fps: FPS, people, depth };
}

// 25fps で onFrame を呼ぶ。止めるときは戻り値の関数を呼ぶ。
export function startDemo(onFrame: (frame: FrameMessage) => void): () => void {
  const start = performance.now();
  let seq = 0;
  const timer = setInterval(() => {
    onFrame(makeDemoFrame(seq++, (performance.now() - start) / 1000));
  }, 1000 / FPS);
  return () => clearInterval(timer);
}
