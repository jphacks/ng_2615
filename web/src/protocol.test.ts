// pi/protocol.py が作った見本（fixtures/protocol/）を読んで、同じ値になるか確かめる。
// 見本は pi/ で `uv run python -m tests.fixture` を実行すると作り直せる。

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { H, W, decode, metersToU8, u8ToMeters } from "./protocol";

const dir = new URL("../../fixtures/protocol/", import.meta.url);
const bin = readFileSync(new URL("frame.bin", dir));
const expected = JSON.parse(readFileSync(new URL("frame.json", dir), "utf-8"));

describe("decode", () => {
  const frame = decode(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

  test("ヘッダーが Python と同じ", () => {
    const { depth, ...header } = frame;
    expect(header).toEqual(expected.header);
    expect(depth.length).toBe(W * H);
  });

  test("深度の画素が Python と同じ位置・値", () => {
    for (const s of expected.samples) {
      expect(frame.depth[s.row * W + s.col]).toBe(s.u8);
    }
  });
});

describe("u8 と m の変換", () => {
  test("境目の値", () => {
    expect(u8ToMeters(0)).toBeNull();
    expect(u8ToMeters(1)).toBeCloseTo(0.3);
    expect(u8ToMeters(255)).toBeCloseTo(4.0);
    expect([0, 0.3, 4.0, 4.01, 0.1, NaN, 2.15, null].map(metersToU8)).toEqual([
      0, 1, 255, 0, 1, 0, 128, 0,
    ]);
  });

  test("往復の誤差は1段の半分以内", () => {
    for (let b = 1; b <= 255; b++) {
      expect(metersToU8(u8ToMeters(b))).toBe(b);
    }
  });
});
