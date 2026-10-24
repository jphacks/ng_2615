// 深度の配色（仕様書 6章）：近いほど黄緑、遠いほど青。4m 超・測れない画素は濃紺。

import { u8ToMeters } from "./protocol";

type RGB = [number, number, number];

export const NO_DATA: RGB = [10, 14, 40];

// [距離 m, 色]。この間を線形につなぐ
const STOPS: [number, RGB][] = [
  [0.3, [200, 255, 70]],
  [1.2, [120, 235, 110]],
  [2.0, [40, 200, 170]],
  [3.0, [40, 130, 240]],
  [4.0, [40, 60, 190]],
];

function colorAt(z: number): RGB {
  for (let i = 1; i < STOPS.length; i++) {
    const [z1, c1] = STOPS[i];
    if (z <= z1) {
      const [z0, c0] = STOPS[i - 1];
      const u = (z - z0) / (z1 - z0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * u)) as RGB;
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// uint8 の深度 → RGBA（毎フレーム計算しないように、256 色を先に作っておく）
export const DEPTH_LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let b = 0; b < 256; b++) {
    const z = u8ToMeters(b);
    const [r, g, bl] = z === null ? NO_DATA : colorAt(z);
    lut.set([r, g, bl, 255], b * 4);
  }
  return lut;
})();

export const SAFE = "#e8f0ff";
export const DANGER = "#ff3b4e";
