import { describe, expect, it } from "vitest";
import { DEPTH_LUT } from "./colors";
import { makeDemoFrame } from "./demo";
import { CAM_HEIGHT, CX, CY, fillCloud, personCuboid, pointAt } from "./geometry";
import { H, W } from "./protocol";

describe("geometry", () => {
  it("真ん中の画素は、少し下を向いて後ろ（-z）へ伸びる", () => {
    const [x, y, z] = pointAt(CY * W + CX, 2.0);
    expect(Math.abs(x)).toBeLessThan(0.02);
    expect(y).toBeLessThan(CAM_HEIGHT);
    expect(z).toBeLessThan(-1.9);
  });

  it("右の画素は +x、上の画素は高い", () => {
    expect(pointAt(CY * W + (W - 1), 2.0)[0]).toBeGreaterThan(0.5);
    expect(pointAt(0 * W + CX, 2.0)[1]).toBeGreaterThan(pointAt((H - 1) * W + CX, 2.0)[1]);
  });

  it("デモの地面は、だいたい高さ 0 に並ぶ", () => {
    const frame = makeDemoFrame(0, 0.5);
    const positions = new Float32Array(W * H * 3);
    const n = fillCloud(frame.depth, [], DEPTH_LUT, positions, new Float32Array(W * H * 3));
    expect(n).toBeGreaterThan(1000);
    // 一番下の行（地面）の点が、端まで平らに並ぶ（uint8 にした分の誤差だけ）
    for (let k = n - W; k < n; k++) expect(Math.abs(positions[k * 3 + 1])).toBeLessThan(0.05);
  });

  it("人を囲む直方体は、その人の距離のあたりにあって、人くらいの大きさ", () => {
    const frame = makeDemoFrame(0, 2.0); // 3.8m でついてくる人
    const p = frame.people[0];
    const box = personCuboid(frame.depth, p)!;
    expect(box).not.toBeNull();
    const centerZ = (box.min[2] + box.max[2]) / 2;
    expect(Math.abs(-centerZ - p.dist)).toBeLessThan(0.3);
    expect(box.max[0] - box.min[0]).toBeGreaterThan(0.25); // 肩幅くらい
    expect(box.max[0] - box.min[0]).toBeLessThan(0.8);
    expect(box.max[1] - box.min[1]).toBeGreaterThan(1.0); // 背の高さくらい
    expect(box.max[2] - box.min[2]).toBeGreaterThanOrEqual(0.15);
  });

  it("人の点が足りなければ直方体は出さない", () => {
    const depth = new Uint8Array(W * H);
    expect(personCuboid(depth, { id: 1, box: [10, 10, 20, 40], dist: 2, speed: 0, ttc: null, approaching: false })).toBeNull();
  });
});
