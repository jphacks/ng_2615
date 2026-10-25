import { describe, expect, it } from "vitest";
import { DEPTH_LUT } from "./colors";
import { makeDemoFrame } from "./demo";
import { BODY_DEPTH, CAM_HEIGHT, CX, CY, fillCloud, personCuboid, pointAt } from "./geometry";
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

  it("人を囲む直方体は、YOLO の枠と人の距離から、人くらいの大きさで、その距離に立つ", () => {
    const frame = makeDemoFrame(0, 2.0); // 3.8m でついてくる人（肩幅 0.45m、背 1.7m）
    const p = frame.people[0];
    const box = personCuboid(p);
    expect(Math.abs(-box.max[2] - p.dist)).toBeLessThan(0.3); // 手前の面が人の距離
    expect(box.max[2] - box.min[2]).toBeCloseTo(BODY_DEPTH); // 奥行きは体の厚み
    expect(box.max[0] - box.min[0]).toBeGreaterThan(0.35);
    expect(box.max[0] - box.min[0]).toBeLessThan(0.6);
    expect(box.min[1]).toBeLessThan(0.1); // 地面に立つ
    expect(box.max[1]).toBeGreaterThan(1.5);
    expect(box.max[1]).toBeLessThan(1.9);
  });

  it("足が写っていない（枠の下が画面の下で切れている）ときは、地面まで伸ばす", () => {
    const box = personCuboid({ id: 1, box: [90, 20, 60, H - 20], dist: 1.2, speed: 0, ttc: null, approaching: false });
    expect(box.min[1]).toBe(0);
    expect(box.max[1]).toBeGreaterThan(1.4);
  });
});
