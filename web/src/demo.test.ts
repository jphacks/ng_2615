// デモデータが仕様書 7章の完了条件の流れ（白 → 赤 → 白）になっているか。

import { expect, test } from "vitest";
import { makeDemoFrame } from "./demo";
import { H, W } from "./protocol";

const at = (t: number) => makeDemoFrame(0, t);

test("同じ速さでついてくる人は白", () => {
  expect(at(2).people[0].approaching).toBe(false);
});

test("早足で追いつくと、TTC が 3 秒以下になって赤", () => {
  expect(at(5).people[0].approaching).toBe(false); // まだ遠い
  const p = at(6.5).people[0];
  expect(p.approaching).toBe(true);
  expect(p.ttc).toBeLessThanOrEqual(3);
});

test("止まると遠ざかって白に戻り、やがて見えなくなる", () => {
  expect(at(8).people[0].approaching).toBe(false);
  expect(at(8).people[0].ttc).toBeNull();
  expect(at(11).people).toEqual([]);
});

test("深度の大きさが約束どおり", () => {
  expect(at(0).depth.length).toBe(W * H);
});
