import { describe, expect, it } from "vitest";
import { makeDemoFrame } from "./demo";
import { BODY_DEPTH, CAM_HEIGHT, CX, CY, personCuboid, pointAt } from "./geometry";
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

  it("人を囲む直方体は、YOLO の枠と人の距離から、人くらいの大きさで、その距離に立つ", () => {
    const frame = makeDemoFrame(0, 2.0); // 3.8m でついてくる人（肩幅 0.45m、背 1.7m）
    const p = frame.people[0];
    const box = personCuboid(p);
    expect(Math.abs(-box.max[2] - p.dist)).toBeLessThan(0.3); // 手前の面が人の距離
    expect(box.max[2] - box.min[2]).toBeCloseTo(BODY_DEPTH); // 奥行きは体の厚み
    expect(box.max[0] - box.min[0]).toBeGreaterThan(0.35);
    expect(box.max[0] - box.min[0]).toBeLessThan(0.6);
    expect(box.min[1]).toBe(0); // 地面に立つ
    expect(box.max[1]).toBeGreaterThan(1.5);
    expect(box.max[1]).toBeLessThan(1.9);
  });

  it("足が写っていなくても、地面に立つ", () => {
    const box = personCuboid({ id: 1, box: [90, 20, 60, H - 20], dist: 1.2, speed: 0, ttc: null, approaching: false });
    expect(box.min[1]).toBe(0);
    expect(box.max[1]).toBeGreaterThan(1.4);
  });

  it("足が写っていて枠が地面より上で終わっていても、箱は浮かない", () => {
    const box = personCuboid({ id: 1, box: [100, 30, 40, 90], dist: 2.5, speed: 0, ttc: null, approaching: false });
    expect(box.min[1]).toBe(0);
  });
});
