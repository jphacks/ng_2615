// 3D 表示用に、深度のノイズを取って点群にする（仕様書 6章「3D ビュー」）。
// Pi の負担を増やさないように、ブラウザでやる。240×180 の深度に、毎フレーム次の順でかける。
//   1. 距離で切る：CLOUD_MAX より遠い点は使わない（遠くはノイズが多い）
//   2. 画素数を落とす：2×2 をまとめて 120×90 に（有効な画素の中央値）
//   3. ノイズを取る：まわりとつながらない点（浮いた点、輪郭のでたらめな距離）を消す。
//      値はならさない（なめらかにしすぎると点群らしさがなくなるため）
//   4. 時間でならす：前のフレームと近ければ混ぜる（ちらつきを抑える）
//   5. 密度に上限を付ける：3D を一辺 VOXEL の箱に区切り、1 つの箱に点は 1 つだけ（近くの密集した点を間引く。
//      近くても遠くても点の並びがだいたい同じ密度になり、密集した点が粒々に見えない）
// 色は深度の色に、まわりの点から求めた面の向きで陰を付ける（立体に見えるように）。人の部分は明るく、接近中は赤く。

import { CAM_HEIGHT, CX, CY, FX, FY, MIN_RADIUS, PERSON_WINDOW, TILT, type Cylinder } from "./geometry";
import { H, W, metersToU8, u8ToMeters, type Person } from "./protocol";

export const STEP = 2; // 画素数を落とす割合
export const GW = W / STEP; // 120
export const GH = H / STEP; // 90
export const CLOUD_MAX = 3.8; // これより遠い点は描かない [m]
const JUMP = 0.12; // となりとこれ以上（＋距離の 3%）離れていたら、つながっていないとみなす [m]
const MIN_LINKS = 3; // まわり 8 点のうち、つながっている点がこれより少なければ消す
const BLEND = 0.5; // 前のフレームとの混ぜ具合（大きいほど今のフレーム）
const LIGHT = normalize([0.35, 0.8, 0.5]); // 陰を付ける光の向き
export const VOXEL = 0.04; // 密度の上限：一辺 4cm の箱に点は 1 つ（面なら 1m² あたり約 625 点まで）[m]
const MIN_PERSON_POINTS = 15; // 人の点がこれより少なければ、点群から円柱を作らない
const LOW = 0.02; // 円柱は、人の点の 2〜98% を囲む（ノイズは取ってあるので、ほぼ全部の点を囲む）
const HIGH = 0.98;
const MARGIN = 0.03; // 円柱を人の点より少しだけ大きくする [m]

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

// 1〜3：距離で切り、2×2 にまとめ、つながらない点を消した深度 [m]（0 は使わない）
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

  // まわり 8 点のうち、つながっている点が少なければ消す
  const out = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const z = coarse[j * GW + i];
      if (z === 0) continue;
      let links = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = j + dy;
          const x = i + dx;
          if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= GW || y >= GH) continue;
          const w = coarse[y * GW + x];
          if (w !== 0 && linked(z, w)) links++;
        }
      }
      if (links >= MIN_LINKS) out[j * GW + i] = z;
    }
  }
  return out;
}

// 5〜95% の範囲
function range(a: number[]): [number, number] {
  a.sort((x, y) => x - y);
  return [a[Math.floor(LOW * (a.length - 1))], a[Math.ceil(HIGH * (a.length - 1))]];
}

function median(a: number[], n: number): number {
  const s = a.slice(0, n).sort((x, y) => x - y);
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// 毎フレーム点群を作る。前のフレームを覚えておくので、ビューごとに 1 つ作る
export class CloudBuilder {
  private prev: Float32Array = new Float32Array(GW * GH);
  private pos = new Float32Array(GW * GH * 3);
  private rgb = new Float32Array(GW * GH * 3);
  private used = new Set<number>(); // 点を置いた箱

  // 残った点を positions・colors（GW×GH×3 あれば足りる）の前に詰めて書き込み、点の数を返す
  build(depth: Uint8Array, people: Person[], lut: Uint8ClampedArray, positions: Float32Array, colors: Float32Array): number {
    const z = cleanDepth(depth);
    for (let k = 0; k < z.length; k++) {
      const p = this.prev[k];
      if (z[k] > 0 && p > 0 && linked(z[k], p)) z[k] = p + (z[k] - p) * BLEND;
    }
    this.prev = z;

    const pos = this.pos;
    for (let k = 0; k < z.length; k++) {
      pos[k * 3] = RX[k] * z[k];
      pos[k * 3 + 1] = CAM_HEIGHT + RY[k] * z[k];
      pos[k * 3 + 2] = RZ[k] * z[k];
    }
    this.color(z, people, lut, pos, this.rgb);

    let n = 0;
    this.used.clear();
    for (let k = 0; k < z.length; k++) {
      if (z[k] === 0) continue;
      // 箱の番号（x は ±4m、y は 0〜3m、z は -4〜0m に収まるので、1 つの数にまとめる）
      const box =
        (Math.floor(pos[k * 3] / VOXEL) + 512) * 1048576 +
        (Math.floor(pos[k * 3 + 1] / VOXEL) + 512) * 1024 +
        (Math.floor(pos[k * 3 + 2] / VOXEL) + 512);
      if (this.used.has(box)) continue;
      this.used.add(box);
      positions.set(pos.subarray(k * 3, k * 3 + 3), n * 3);
      colors.set(this.rgb.subarray(k * 3, k * 3 + 3), n * 3);
      n++;
    }
    return n;
  }

  // 直前の build の点群から、人を囲む円柱を作る。枠の中で人の距離に近い点を、そのまま囲むだけ：
  // 中心は点の左右・前後の広がりの真ん中、半径は広がりの大きいほうの半分、上下は点の一番下から一番上まで。
  // 点が少なすぎれば null
  personCylinder(p: Person): Cylinder | null {
    const z = this.prev;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const [bx, by, bw, bh] = p.box;
    for (let j = Math.max(0, Math.floor(by / STEP)); j < Math.min(GH, Math.ceil((by + bh) / STEP)); j++) {
      for (let i = Math.max(0, Math.floor(bx / STEP)); i < Math.min(GW, Math.ceil((bx + bw) / STEP)); i++) {
        const k = j * GW + i;
        if (z[k] === 0 || Math.abs(z[k] - p.dist) > PERSON_WINDOW) continue;
        xs.push(this.pos[k * 3]);
        ys.push(this.pos[k * 3 + 1]);
        zs.push(this.pos[k * 3 + 2]);
      }
    }
    if (xs.length < MIN_PERSON_POINTS) return null;
    const [x0, x1] = range(xs);
    const [y0, y1] = range(ys);
    const [z0, z1] = range(zs);
    const r = Math.max(MIN_RADIUS, Math.max(x1 - x0, z1 - z0) / 2 + MARGIN);
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r, bottom: Math.max(0, y0 - MARGIN), top: y1 + MARGIN };
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
