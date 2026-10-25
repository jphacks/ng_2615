// 深度 → 3D の点（仕様書 6章「3D 点群ビュー」）。
// センサーは肩の高さ CAM_HEIGHT にあり、TILT だけ下を向いている（仕様書 10章）。
// 深度はセンサーから点までのまっすぐな距離とみなし、画素ごとの向き（単位ベクトル）を掛けて 3D にする。
//
// 3D の座標（three.js に合わせる）：x は右、y は上（地面が 0）、センサーが向いている先（後ろ）が -z。
// 見る人はセンサーの後ろから、センサーと同じ向きを見る（2D の深度ビューと左右が同じになる）。

import { H, W, u8ToMeters, type Person } from "./protocol";

export const FX = 171; // 焦点距離 [px]（水平の視野 約 70°。pi/fake_sensor.py・demo.ts と同じ）
export const FY = 171;
export const CX = W / 2;
export const CY = H / 2;
export const CAM_HEIGHT = 1.4; // 肩の高さ [m]
export const TILT = (10 * Math.PI) / 180; // 下向きの角度
export const HALF_FOV = Math.atan(CX / FX); // 水平の視野の半分 [rad]
export const PERSON_WINDOW = 0.4; // 人の部分とみなす距離の幅 [m]（pi/track.py の DIST_WINDOW と同じ）

// 画素ごとの向き。点 = (RAY_X * r, CAM_HEIGHT + RAY_Y * r, RAY_Z * r)
const RAY_X = new Float32Array(W * H);
const RAY_Y = new Float32Array(W * H);
const RAY_Z = new Float32Array(W * H);
for (let v = 0; v < H; v++) {
  for (let u = 0; u < W; u++) {
    const x = (u + 0.5 - CX) / FX;
    const y = (v + 0.5 - CY) / FY; // 下が正
    const n = Math.hypot(x, y, 1);
    const i = v * W + u;
    RAY_X[i] = x / n;
    RAY_Y[i] = -(y * Math.cos(TILT) + Math.sin(TILT)) / n;
    RAY_Z[i] = -(Math.cos(TILT) - y * Math.sin(TILT)) / n;
  }
}

// 画素 i の距離 r [m] の点
export function pointAt(i: number, r: number): [number, number, number] {
  return [RAY_X[i] * r, CAM_HEIGHT + RAY_Y[i] * r, RAY_Z[i] * r];
}

// 画素 i の向きで、地面（高さ 0）までの距離 [m]。地面に当たらなければ null（demo.ts 用）
export function rangeToGround(i: number): number | null {
  return RAY_Y[i] < 0 ? CAM_HEIGHT / -RAY_Y[i] : null;
}

// 画素 i の向きで、センサーから水平に z [m] 先の、立っている面までの距離 [m]（demo.ts 用）
export function rangeToWall(i: number, z: number): number {
  return z / -RAY_Z[i];
}

// 測れた画素を 3D の点にして positions に詰める。戻り値は点の数。
// colors には、深度の色 lut（256 色 × RGBA、0〜255）を 0〜1 にして入れる。人の部分は明るく、接近中は赤く。
export function fillCloud(
  depth: Uint8Array,
  people: Person[],
  lut: Uint8ClampedArray,
  positions: Float32Array,
  colors: Float32Array,
): number {
  const tint = new Float32Array(W * H * 4); // 人の部分の色を混ぜる [r, g, b, 割合]
  for (const p of people) {
    forEachPersonPixel(depth, p, (i) => {
      tint.set(p.approaching ? [1, 0.23, 0.31, 0.75] : [1, 1, 1, 0.5], i * 4);
    });
  }
  let n = 0;
  for (let i = 0; i < depth.length; i++) {
    const r = u8ToMeters(depth[i]);
    if (r === null) continue;
    positions[n * 3] = RAY_X[i] * r;
    positions[n * 3 + 1] = CAM_HEIGHT + RAY_Y[i] * r;
    positions[n * 3 + 2] = RAY_Z[i] * r;
    const m = tint[i * 4 + 3];
    for (let k = 0; k < 3; k++) colors[n * 3 + k] = (lut[depth[i] * 4 + k] / 255) * (1 - m) + tint[i * 4 + k] * m;
    n++;
  }
  return n;
}

export interface Cuboid {
  min: [number, number, number];
  max: [number, number, number];
}

export const BODY_DEPTH = 0.4; // 人の体の厚み [m]（直方体の奥行き）

// 人を囲む直方体（地面に沿った向き）。人が立っている前提で、YOLO の枠と人の距離だけから作る。
// 幅・高さは枠の端を人の距離のところで 3D に直した大きさ。手前の面が人の距離で、奥へ体の厚みだけ伸ばす（底面は長方形）。
// 枠の下が画面の下で切れているとき（足が写っていない）は、地面まで伸ばす。
export function personCuboid(p: Person): Cuboid {
  const [bx, by, bw, bh] = p.box;
  const col = (x: number) => Math.min(W - 1, Math.max(0, Math.round(x)));
  const row = (y: number) => Math.min(H - 1, Math.max(0, Math.round(y)));
  const midRow = row(by + bh / 2);
  const midCol = col(bx + bw / 2);
  const left = pointAt(midRow * W + col(bx), p.dist);
  const right = pointAt(midRow * W + col(bx + bw - 1), p.dist);
  const top = pointAt(row(by) * W + midCol, p.dist);
  const bottom = pointAt(row(by + bh - 1) * W + midCol, p.dist);
  const front = pointAt(midRow * W + midCol, p.dist)[2];
  const ground = by + bh >= H - 1 ? 0 : Math.max(0, bottom[1]);
  return {
    min: [left[0], ground, front - BODY_DEPTH],
    max: [right[0], Math.max(top[1], ground + 0.1), front],
  };
}

function forEachPersonPixel(depth: Uint8Array, p: Person, visit: (i: number, r: number) => void) {
  const [bx, by, bw, bh] = p.box;
  for (let y = Math.max(0, by); y < Math.min(H, by + bh); y++) {
    for (let x = Math.max(0, bx); x < Math.min(W, bx + bw); x++) {
      const i = y * W + x;
      const r = u8ToMeters(depth[i]);
      if (r !== null && Math.abs(r - p.dist) <= PERSON_WINDOW) visit(i, r);
    }
  }
}
