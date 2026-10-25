// デモデータが、いろいろな速さで近づく人で、3.5m あたりから赤になるか。

import { expect, test } from "vitest";
import { makeDemoFrame } from "./demo";
import { H, W } from "./protocol";

const at = (t: number) => makeDemoFrame(0, t);

test("同じ距離でついてくる人は白", () => {
  expect(at(2).people[0].dist).toBeCloseTo(3.8);
  expect(at(2).people[0].approaching).toBe(false);
});

test("早足（0.8 m/s）：3.5m より遠いうちは白、入ったら赤", () => {
  expect(at(4.2).people[0].approaching).toBe(false); // 約 3.6m
  expect(at(5).people[0].approaching).toBe(true); // 約 3.0m
});

test("ゆっくり（0.5 m/s）でも、3.5m 以内なら TTC が長くても赤", () => {
  expect(at(12).people[0].approaching).toBe(false); // 約 3.8m
  const p = at(14).people[0]; // 約 2.8m
  expect(p.speed).toBeCloseTo(0.5);
  expect(p.approaching).toBe(true);
  expect(p.ttc).toBeGreaterThan(3);
});

test("じわじわ（0.2 m/s）でも、3.5m 以内なら赤", () => {
  expect(at(24).people[0].approaching).toBe(false); // 約 3.7m
  expect(at(26.5).people[0].approaching).toBe(true); // 約 3.2m
});

test("速歩き（1.2 m/s）と走り（2.5 m/s）は赤", () => {
  expect(at(31).people[0].approaching).toBe(true);
  expect(at(37.1).people[0].approaching).toBe(true); // 約 3.75m でも TTC が短いので赤
});

test("止まると遠ざかって白に戻り、やがて見えなくなる", () => {
  expect(at(8.6).people[0].approaching).toBe(false);
  expect(at(8.6).people[0].ttc).toBeNull();
  expect(at(11).people).toEqual([]);
});

test("深度の大きさが約束どおり", () => {
  expect(at(0).depth.length).toBe(W * H);
});
