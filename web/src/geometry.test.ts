import { describe, expect, it } from "vitest";
import { makeDemoFrame } from "./demo";
import { CAM_HEIGHT, CX, CY, MIN_RADIUS, personCylinder, pointAt } from "./geometry";
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

  it("人を囲む円柱は、YOLO の枠と人の距離から、人くらいの大きさで、その距離に立つ", () => {
    const frame = makeDemoFrame(0, 2.0); // 3.8m でついてくる人（肩幅 0.45m、背 1.7m）
    const p = frame.people[0];
    const c = personCylinder(p);
    expect(Math.abs(-(c.z + c.r) - p.dist)).toBeLessThan(0.3); // 手前が人の距離
    expect(c.r).toBeGreaterThan(0.18);
    expect(c.r).toBeLessThan(0.3);
    expect(c.h).toBeGreaterThan(1.5);
    expect(c.h).toBeLessThan(1.9);
  });

  it("枠が細くても、円柱は細すぎない", () => {
    const c = personCylinder({ id: 1, box: [118, 30, 4, 90], dist: 2.5, speed: 0, ttc: null, approaching: false });
    expect(c.r).toBe(MIN_RADIUS);
  });
});
