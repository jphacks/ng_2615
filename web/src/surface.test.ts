import { describe, expect, it } from "vitest";
import { DEPTH_LUT } from "./colors";
import { makeDemoFrame } from "./demo";
import { H, W, metersToU8 } from "./protocol";
import { CLOUD_MAX, GH, GW, SurfaceBuilder, cleanDepth } from "./surface";

const flat = (z: number) => new Uint8Array(W * H).fill(metersToU8(z));

describe("surface", () => {
  it("2×2 にまとめて 120×90 にする", () => {
    const z = cleanDepth(flat(2.0));
    expect(z.length).toBe(GW * GH);
    expect(z[45 * GW + 60]).toBeCloseTo(2.0, 1);
  });

  it("遠すぎる点は使わない", () => {
    expect(cleanDepth(flat(CLOUD_MAX + 0.1)).every((v) => v === 0)).toBe(true);
  });

  it("まわりとつながらない浮いた点は消す", () => {
    const depth = new Uint8Array(W * H);
    for (let y = 80; y < 82; y++) for (let x = 100; x < 102; x++) depth[y * W + x] = metersToU8(2.0); // 2×2 画素だけ
    expect(cleanDepth(depth).some((v) => v > 0)).toBe(false);
  });

  it("距離が飛ぶところ（人と背景のさかい）はつながない", () => {
    const depth = flat(3.0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) depth[y * W + x] = metersToU8(1.5);
    const index = new Uint32Array((GW - 1) * (GH - 1) * 6);
    const n = new SurfaceBuilder().build(
      depth,
      [],
      DEPTH_LUT,
      new Float32Array(GW * GH * 3),
      new Float32Array(GW * GH * 3),
      index,
    );
    expect(n).toBeGreaterThan(0);
    for (let k = 0; k < n; k += 3) {
      const cols = [index[k], index[k + 1], index[k + 2]].map((v) => v % GW);
      expect(cols.every((c) => c < GW / 2) || cols.every((c) => c >= GW / 2)).toBe(true);
    }
  });

  it("デモの地面は、高さ 0 の面になる", () => {
    const positions = new Float32Array(GW * GH * 3);
    const n = new SurfaceBuilder().build(
      makeDemoFrame(0, 0.5).depth,
      [],
      DEPTH_LUT,
      positions,
      new Float32Array(GW * GH * 3),
      new Uint32Array((GW - 1) * (GH - 1) * 6),
    );
    expect(n).toBeGreaterThan(1000);
    const k = (GH - 1) * GW + GW / 2; // 一番下の行の真ん中
    expect(Math.abs(positions[k * 3 + 1])).toBeLessThan(0.05);
  });
});
