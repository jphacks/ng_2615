// 警告音の強さ（危険度）が、距離のグラデーション＋TTC の上乗せになっているか。
// 鳴り始めのフェードイン（小さく始めて約1秒で本来の音量）と、すぐまた鳴ったときに続きからになるか。

import { expect, test } from "vitest";
import { dangerOf, fadeOf, fadeStartAfter } from "./alarm";

const at = (dist: number, ttc: number | null = null) => dangerOf([{ dist, ttc }])!;

test("誰もいなければ鳴らさない", () => {
  expect(dangerOf([])).toBeNull();
});

test("3.5m → 0m で 0 → 1 のグラデーション", () => {
  expect(at(3.5)).toBeCloseTo(0);
  expect(at(2.0)).toBeCloseTo(1.5 / 3.5);
  expect(at(1.0)).toBeCloseTo(2.5 / 3.5);
  expect(at(0.0)).toBeCloseTo(1);
  expect(at(1.5)).toBeGreaterThan(at(2.5));
});

test("ゆっくり近づく人は、TTC が長いので距離だけで決まる", () => {
  expect(at(2.0, 4.0)).toBeCloseTo(at(2.0));
});

test("3m より遠くても速く迫る人は、TTC の分だけ強くなる", () => {
  expect(at(3.8, 1.2)).toBeCloseTo(0.6);
});

test("一番危ない人に合わせる", () => {
  expect(dangerOf([{ dist: 2.5, ttc: null }, { dist: 0.9, ttc: null }])).toBeCloseTo(2.6 / 3.5);
});

test("鳴り始めは小さく、1秒で本来の音量になる", () => {
  expect(fadeOf(0)).toBeCloseTo(0.3);
  expect(fadeOf(1.0)).toBeCloseTo(1);
  expect(fadeOf(3.0)).toBeCloseTo(1);
});

test("フェードは最初ゆっくり、後半で大きくなる", () => {
  expect(fadeOf(0.5)).toBeCloseTo(0.3 + 0.7 * 0.25);
  expect(fadeOf(0.5) - fadeOf(0)).toBeLessThan(fadeOf(1.0) - fadeOf(0.5));
});

test("初めて鳴るときは、今から小さく始める", () => {
  expect(fadeStartAfter(null, null, 10)).toBe(10);
});

test("一瞬途切れてまた鳴ったら、フェードは止まったところから続ける", () => {
  // 10秒に鳴り始め、10.6秒に止まり、10.633秒（1フレーム後）にまた鳴った
  const start = fadeStartAfter(10, 10.6, 10.633);
  expect(10.633 - start).toBeCloseTo(0.6);
  expect(fadeOf(10.633 - start)).toBeCloseTo(fadeOf(0.6));
});

test("しばらく止まっていたら、次はまた小さく始める", () => {
  expect(fadeStartAfter(10, 11, 13)).toBe(13);
});
