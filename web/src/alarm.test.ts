// 警告音の強さ（危険度）が、距離のグラデーション＋TTC の上乗せになっているか。

import { expect, test } from "vitest";
import { dangerOf } from "./alarm";

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
