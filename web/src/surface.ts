// 3D 表示用に深度をきれいにして、つながった面（三角形の網）にする（仕様書 6章「3D 点群ビュー」）。
// Pi の負担を増やさないように、ブラウザでやる。240×180 の深度に、毎フレーム次の順でかける。
//   1. 距離で切る：CLOUD_MAX より遠い点は使わない（遠くはノイズが多い）
//   2. 画素数を落とす：2×2 をまとめて 120×90 に（有効な画素の中央値）
//   3. ノイズを取る：3×3 の中央値でならし、まわりとつながらない点（浮いた点、輪郭のでたらめな距離）を消す
//   4. 時間でならす：前のフレームと近ければ混ぜる（ちらつきを抑える）
//   5. 面にする：となり合う 4 点が近い距離なら四角（三角形 2 つ）でつなぐ。距離が飛ぶところ（人と背景のさかい）はつながない
// 色は深度の色に、面の向きで陰を付ける（立体に見えるように）。人の部分は明るく、接近中は赤く。

import { CAM_HEIGHT, CX, CY, FX, FY, PERSON_WINDOW, TILT } from "./geometry";
import { H, W, metersToU8, u8ToMeters, type Person } from "./protocol";

export const STEP = 2; // 画素数を落とす割合
export const GW = W / STEP; // 120
export const GH = H / STEP; // 90
export const CLOUD_MAX = 3.8; // これより遠い点は描かない [m]
const JUMP = 0.12; // となりとこれ以上（＋距離の 3%）離れていたら、つながっていないとみなす [m]
const MIN_LINKS = 3; // まわり 8 点のうち、つながっている点がこれより少なければ消す
const BLEND = 0.5; // 前のフレームとの混ぜ具合（大きいほど今のフレーム）
const LIGHT = normalize([0.35, 0.8, 0.5]); // 陰を付ける光の向き

function normalize(v: number[]): [number, number, number] {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

// 間引いた格子の点ごとの向き（geometry.ts と同じ置き方）
const RX = new Float32Array(GW * GH);
const RY = new Float32Array(GW * GH);
const RZ = new Float32Array(GW * GH);
for (let j = 0; j < GH; j++) {
  for (let i = 0; i < GW; i++) {
    const x = ((i + 0.5) * STEP - CX) / FX;
    const y = ((j + 0.5) * STEP - CY) / FY;
    const n = Math.hypot(x, y, 1);
    const k = j * GW + i;
    RX[k] = x / n;
    RY[k] = -(y * Math.cos(TILT) + Math.sin(TILT)) / n;
    RZ[k] = -(Math.cos(TILT) - y * Math.sin(TILT)) / n;
  }
}

const linked = (a: number, b: number) => Math.abs(a - b) <= JUMP + 0.03 * Math.min(a, b);

// 1〜3：距離で切り、2×2 にまとめ、ノイズを取った深度 [m]（0 は使わない）
export function cleanDepth(depth: Uint8Array): Float32Array {
  const coarse = new Float32Array(GW * GH);
  const v = [0, 0, 0, 0];
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      let n = 0;
      for (let dy = 0; dy < STEP; dy++) {
        for (let dx = 0; dx < STEP; dx++) {
          const r = u8ToMeters(depth[(j * STEP + dy) * W + i * STEP + dx]);
          if (r !== null && r <= CLOUD_MAX) v[n++] = r;
        }
      }
      coarse[j * GW + i] = n >= 2 ? median(v, n) : 0;
    }
  }

  // 3×3 の中央値でならし、つながらない点を消す
  const out = new Float32Array(GW * GH);
  const around = new Array<number>(9);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const z = coarse[j * GW + i];
      if (z === 0) continue;
      let n = 0;
      let links = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = j + dy;
          const x = i + dx;
          if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
          const w = coarse[y * GW + x];
          if (w === 0 || !linked(z, w)) continue;
          around[n++] = w;
          if (dx !== 0 || dy !== 0) links++;
        }
      }
      if (links >= MIN_LINKS) out[j * GW + i] = median(around, n);
    }
  }
  return out;
}

function median(a: number[], n: number): number {
  const s = a.slice(0, n).sort((x, y) => x - y);
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// 4〜5 を毎フレーム行う。前のフレームを覚えておくので、ビューごとに 1 つ作る
export class SurfaceBuilder {
  private prev: Float32Array = new Float32Array(GW * GH);

  // positions・colors（GW×GH×3）と index（三角形の頂点番号）に書き込み、index の数を返す
  build(
    depth: Uint8Array,
    people: Person[],
    lut: Uint8ClampedArray,
    positions: Float32Array,
    colors: Float32Array,
    index: Uint32Array,
  ): number {
    const z = cleanDepth(depth);
    for (let k = 0; k < z.length; k++) {
      const p = this.prev[k];
      if (z[k] > 0 && p > 0 && linked(z[k], p)) z[k] = p + (z[k] - p) * BLEND;
    }
    this.prev = z;

    for (let k = 0; k < z.length; k++) {
      positions[k * 3] = RX[k] * z[k];
      positions[k * 3 + 1] = CAM_HEIGHT + RY[k] * z[k];
      positions[k * 3 + 2] = RZ[k] * z[k];
    }

    let n = 0;
    for (let j = 0; j + 1 < GH; j++) {
      for (let i = 0; i + 1 < GW; i++) {
        const a = j * GW + i;
        const b = a + 1;
        const c = a + GW;
        const d = c + 1;
        const za = z[a];
        const zb = z[b];
        const zc = z[c];
        const zd = z[d];
        if (za === 0 || zb === 0 || zc === 0 || zd === 0) continue;
        if (!linked(za, zb) || !linked(za, zc) || !linked(zd, zb) || !linked(zd, zc)) continue;
        index[n++] = a;
        index[n++] = c;
        index[n++] = b;
        index[n++] = b;
        index[n++] = c;
        index[n++] = d;
      }
    }

    this.color(z, people, lut, positions, colors);
    return n;
  }

  private color(z: Float32Array, people: Person[], lut: Uint8ClampedArray, pos: Float32Array, colors: Float32Array) {
    const tints = people.map((p) => ({
      x0: p.box[0] / STEP,
      y0: p.box[1] / STEP,
      x1: (p.box[0] + p.box[2]) / STEP,
      y1: (p.box[1] + p.box[3]) / STEP,
      dist: p.dist,
      rgb: p.approaching ? [1, 0.23, 0.31] : [1, 1, 1],
      mix: p.approaching ? 0.7 : 0.45,
    }));
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        if (z[k] === 0) continue;
        // 面の向き（となりの点との差の外積）で陰を付ける
        const l = z[k - 1] > 0 && i > 0 ? k - 1 : k;
        const r = z[k + 1] > 0 && i + 1 < GW ? k + 1 : k;
        const u = z[k - GW] > 0 && j > 0 ? k - GW : k;
        const d = z[k + GW] > 0 && j + 1 < GH ? k + GW : k;
        const ex = [pos[r * 3] - pos[l * 3], pos[r * 3 + 1] - pos[l * 3 + 1], pos[r * 3 + 2] - pos[l * 3 + 2]];
        const ey = [pos[u * 3] - pos[d * 3], pos[u * 3 + 1] - pos[d * 3 + 1], pos[u * 3 + 2] - pos[d * 3 + 2]];
        const nx = ex[1] * ey[2] - ex[2] * ey[1];
        const ny = ex[2] * ey[0] - ex[0] * ey[2];
        const nz = ex[0] * ey[1] - ex[1] * ey[0];
        const nl = Math.hypot(nx, ny, nz) || 1;
        const shade = 0.5 + 0.5 * Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);

        const c = metersToU8(z[k]) * 4;
        let rgb = [lut[c] / 255, lut[c + 1] / 255, lut[c + 2] / 255];
        for (const t of tints) {
          if (i >= t.x0 && i < t.x1 && j >= t.y0 && j < t.y1 && Math.abs(z[k] - t.dist) <= PERSON_WINDOW) {
            rgb = rgb.map((v, m) => v * (1 - t.mix) + t.rgb[m] * t.mix);
          }
        }
        for (let m = 0; m < 3; m++) colors[k * 3 + m] = rgb[m] * shade;
      }
    }
  }
}
