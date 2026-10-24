// Pi → ブラウザの WebSocket メッセージを読む（仕様書 4章）。
// 形式を変えるときは、仕様書 4章と pi/protocol.py も一緒に直す。

export const W = 240;
export const H = 180;
export const Z_MIN = 0.3; // uint8 で表せる距離 [m]
export const Z_MAX = 4.0;

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
  depth: Uint8Array; // 行ごと、左上から。0 = 測れない、1〜255 = 0.3〜4.0m
}

// [JSON の長さ uint32 LE][JSON][深度 uint8 × H × W] を読む
export function decode(buf: ArrayBuffer): FrameMessage {
  const n = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const depth = new Uint8Array(buf, 4 + n);
  if (depth.length !== header.w * header.h) {
    throw new Error(`深度のバイト数が合わない: ${depth.length}`);
  }
  return { ...header, depth };
}

// uint8 → m（0 は null）
export function u8ToMeters(b: number): number | null {
  if (b === 0) return null;
  return Z_MIN + ((b - 1) / 254) * (Z_MAX - Z_MIN);
}

// m → uint8（demo.ts 用。pi/protocol.py の depth_to_u8 と同じ規則）
export function metersToU8(z: number | null): number {
  if (z === null || !Number.isFinite(z) || z <= 0 || z > Z_MAX) return 0;
  const c = Math.min(Math.max(z, Z_MIN), Z_MAX);
  return Math.round(((c - Z_MIN) / (Z_MAX - Z_MIN)) * 254 + 1);
}
