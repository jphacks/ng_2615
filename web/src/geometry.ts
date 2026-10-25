// 深度 → 3D の点（仕様書 6章「3D 点群ビュー」）。
// センサーは肩の高さ CAM_HEIGHT にあり、TILT だけ下を向いている（仕様書 10章）。
// 深度はセンサーから点までのまっすぐな距離とみなし、画素ごとの向き（単位ベクトル）を掛けて 3D にする。
//
// 3D の座標（three.js に合わせる）：x は右、y は上（地面が 0）、センサーが向いている先（後ろ）が -z。
// 見る人はセンサーの後ろから、センサーと同じ向きを見る（2D の深度ビューと左右が同じになる）。

import { H, W, type Person } from "./protocol";

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

export interface Cuboid {
  min: [number, number, number];
  max: [number, number, number];
}

export const BODY_DEPTH = 0.4; // 人の体の厚み [m]（直方体の奥行き）

// 人を囲む直方体（地面に沿った向き）。人が立っている前提で、YOLO の枠と人の距離だけから作る。
// 幅と上の面は、枠の端を人の距離のところで 3D に直した位置。手前の面が人の距離で、奥へ体の厚みだけ伸ばす（底面は長方形）。
// 下の面はいつも地面。足元は胴より遠いので、枠の下端を人の距離で 3D に直すと地面より上になり、箱が浮いて見えるため。
export function personCuboid(p: Person): Cuboid {
  const [bx, by, bw, bh] = p.box;
  const col = (x: number) => Math.min(W - 1, Math.max(0, Math.round(x)));
  const row = (y: number) => Math.min(H - 1, Math.max(0, Math.round(y)));
  const midRow = row(by + bh / 2);
  const midCol = col(bx + bw / 2);
  const left = pointAt(midRow * W + col(bx), p.dist);
  const right = pointAt(midRow * W + col(bx + bw - 1), p.dist);
  const top = pointAt(row(by) * W + midCol, p.dist);
  const front = pointAt(midRow * W + midCol, p.dist)[2];
  return {
    min: [left[0], 0, front - BODY_DEPTH],
    max: [right[0], Math.max(top[1], 0.1), front],
  };
}
