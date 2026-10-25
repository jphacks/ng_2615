// Pi につながらないときのデモデータ。protocol.ts の FrameMessage と同じ形で返す。
// 流れは pi/fake_sensor.py の SCENARIO と同じ：ついてくる → いろいろな速さで近づく人（0.8・0.5・0.2・1.2・2.5 m/s）。
// Pi がいないので、接近の判定もここでする（本物はブラウザでは判定しない）。

import { CAM_HEIGHT, FX, TILT, rangeToGround, rangeToWall } from "./geometry";
import { H, W, metersToU8, type FrameMessage, type Person } from "./protocol";

const FPS = 25;
// 接近判定（仕様書 5章、pi/track.py と同じ）：近づいていて、3.5m 以内か TTC 3 秒以下
const MIN_SPEED = 0.1; // [m/s]（ノイズで鳴ったり止まったりしない最小限）
const WARN_DIST = 3.5; // [m]
const MAX_TTC = 3.0; // [s]

// [秒, 始めの距離, 終わりの距離]、null はいない
// 近づく場面のあとは毎回「止まる（装着者が歩くので遠ざかる）→ 見えなくなる」
const SCENARIO: [number, number | null, number | null][] = [
  [4.0, 3.8, 3.8], // 1. 同じ速さでついてくる → 白
  [3.4, 3.8, 1.1], // 2. 早足で追いつく（0.8 m/s）→ 3.5m から赤
  [2.7, 1.1, 4.3],
  [1.5, null, null],
  [6.4, 4.0, 0.8], // 3. ゆっくり近づく（0.5 m/s）→ 3.5m から赤
  [2.9, 0.8, 4.3],
  [1.5, null, null],
  [5.0, 4.0, 3.0], // 4. じわじわ寄ってくる（0.2 m/s）→ 3.5m から赤
  [1.0, 3.0, 4.2],
  [1.5, null, null],
  [2.7, 4.0, 0.76], // 5. 速歩きで追い抜く（1.2 m/s）→ 3.6m あたりから赤
  [2.9, 0.76, 4.3],
  [1.5, null, null],
  [1.3, 4.0, 0.75], // 6. 走ってくる（2.5 m/s）→ 3.5m より遠くても赤
  [2.9, 0.75, 4.3],
  [1.8, null, null],
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

// 地面だけのときの深度（3D 点群ビューで地面が平らに見えるように、画素ごとに地面までの距離を出す）
const ground = Uint8Array.from({ length: W * H }, (_, i) => metersToU8(rangeToGround(i)));

// 時刻 t [s] のデモフレーム（テストでも使う）
export function makeDemoFrame(seq: number, t: number): FrameMessage {
  const depth = ground.slice();

  const people: Person[] = [];
  const { z, speed } = distanceAt(t);
  if (z !== null && z <= 4.0) {
    const x = 0.15 * Math.sin(t * 0.8);
    const halfWidth = 0.225;
    const x0 = Math.max(0, Math.floor(W / 2 + (FX * (x - halfWidth)) / z));
    const x1 = Math.min(W, Math.ceil(W / 2 + (FX * (x + halfWidth)) / z));
    const y0 = Math.max(0, Math.floor(rowOf(1.7, z)));
    const y1 = Math.min(H, Math.ceil(rowOf(0, z)));
    // 人は、水平に z 先に立っている板とみなす
    for (let y = y0; y < y1; y++) {
      for (let i = y * W + x0; i < y * W + x1; i++) depth[i] = metersToU8(rangeToWall(i, z));
    }

    const ttc = speed > 0 ? z / speed : null;
    people.push({
      id: 1 + Math.floor(t / LENGTH), // 一周ごとに新しい人
      box: [x0, y0, x1 - x0, y1 - y0],
      dist: z,
      speed,
      ttc,
      approaching: speed >= MIN_SPEED && (z <= WARN_DIST || (ttc !== null && ttc <= MAX_TTC)),
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
