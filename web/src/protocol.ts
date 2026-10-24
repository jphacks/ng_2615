// Pi → ブラウザの WebSocket メッセージを読む（仕様書 4章）。
// 形式を変えるときは、仕様書 4章と pi/protocol.py も一緒に直す。

export const W = 240;
export const H = 180;

export interface Person {
  id: number;
  box: [number, number, number, number]; // x, y, w, h（センサー画素）
  dist: number; // m
  speed: number; // m/s、近づくと正
  ttc: number | null; // 秒、近づいていなければ null
  approaching: boolean;
}

export interface FrameMessage {
  seq: number;
  t: number; // ms
  w: number;
  h: number;
  fps: number;
  people: Person[];
  depth: Uint8Array; // W × H、0 = 測れない、1〜255 = 0.3〜4.0m
}

// [JSON の長さ uint32 LE][JSON][深度 uint8 × H × W] を読む
export function decode(_buf: ArrayBuffer): FrameMessage {
  // TODO
  throw new Error("not implemented");
}

// uint8 → m（0 は null）
export function u8ToMeters(_b: number): number | null {
  // TODO
  throw new Error("not implemented");
}
