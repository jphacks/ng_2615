import { describe, expect, it } from "vitest";
import { DEPTH_LUT } from "./colors";
import { makeDemoFrame } from "./demo";
import { H, W, metersToU8 } from "./protocol";
import { CLOUD_MAX, CloudBuilder, GH, GW, cleanDepth } from "./cloud";

const flat = (z: number) => new Uint8Array(W * H).fill(metersToU8(z));

describe("cloud", () => {
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

  it("値はならさない（人と背景のさかいも、それぞれの距離のまま）", () => {
    const depth = flat(3.0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) depth[y * W + x] = metersToU8(1.5);
    const z = cleanDepth(depth);
    expect(z[45 * GW + GW / 2 - 1]).toBeCloseTo(1.5, 1);
    expect(z[45 * GW + GW / 2]).toBeCloseTo(3.0, 1);
  });

  it("人を囲む直方体は、人の点の広がりに合わせ、下の面は地面", () => {
    const frame = makeDemoFrame(0, 5.0); // 約 3.0m の人（肩幅 0.45m、背 1.7m）
    const builder = new CloudBuilder();
    builder.build(frame.depth, frame.people, DEPTH_LUT, new Float32Array(GW * GH * 3), new Float32Array(GW * GH * 3));
    const box = builder.personCuboid(frame.people[0])!;
    expect(box).not.toBeNull();
    expect(box.min[1]).toBe(0);
    expect(box.max[0] - box.min[0]).toBeGreaterThan(0.3);
    expect(box.max[0] - box.min[0]).toBeLessThan(0.6);
    expect(box.max[1]).toBeGreaterThan(1.4);
    expect(box.max[1]).toBeLessThan(1.9);
    expect(box.max[2] - box.min[2]).toBeGreaterThanOrEqual(0.3 - 1e-6); // 奥行きは最小 0.3m
    expect(Math.abs(-box.max[2] - frame.people[0].dist)).toBeLessThan(0.3);
  });

  it("人の点がなければ直方体は作らない", () => {
    const builder = new CloudBuilder();
    builder.build(new Uint8Array(W * H), [], DEPTH_LUT, new Float32Array(GW * GH * 3), new Float32Array(GW * GH * 3));
    expect(builder.personCuboid({ id: 1, box: [10, 10, 40, 80], dist: 2, speed: 0, ttc: null, approaching: false })).toBeNull();
  });

  it("デモの地面の点は、高さ 0 に並ぶ。残った点だけを前に詰める", () => {
    const positions = new Float32Array(GW * GH * 3);
    const n = new CloudBuilder().build(makeDemoFrame(0, 11.0).depth, [], DEPTH_LUT, positions, new Float32Array(GW * GH * 3)); // 人がいない
    expect(n).toBeGreaterThan(1000);
    expect(n).toBeLessThan(GW * GH);
    for (let k = 0; k < n; k++) expect(Math.abs(positions[k * 3 + 1])).toBeLessThan(0.05);
  });
});
