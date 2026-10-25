"""Pi → ブラウザの WebSocket メッセージを作る（仕様書 4章）。

形式を変えるときは、仕様書 4章と web/src/protocol.ts も一緒に直す。
"""

import json
import struct
from dataclasses import dataclass

import numpy as np

from datatypes import H, W, Person

Z_MIN, Z_MAX = 0.3, 4.0  # uint8 で表せる距離 [m]
_HEADER = struct.Struct("<I")  # JSON の長さ（uint32 リトルエンディアン）


def depth_to_u8(depth: np.ndarray) -> np.ndarray:
    """float32 [m] → uint8。0 = 測れない、1〜255 = 0.3〜4.0m。

    0 以下と 4.0m 超は 0（測れない）。0.3m 未満は 1 に寄せる。
    """
    d = np.nan_to_num(depth, nan=0.0, posinf=0.0, neginf=0.0)
    z = np.clip(d, Z_MIN, Z_MAX)
    # .5 は切り上げ（TS の Math.round と同じ丸め方にそろえる）
    b = np.floor((z - Z_MIN) / (Z_MAX - Z_MIN) * 254 + 1.5).astype(np.uint8)
    b[(d <= 0) | (d > Z_MAX)] = 0
    return b


def u8_to_depth(b: np.ndarray) -> np.ndarray:
    """uint8 → float32 [m]。0 は 0（測れない）のまま。"""
    z = (Z_MIN + (b.astype(np.float32) - 1) / 254 * (Z_MAX - Z_MIN)).astype(np.float32)
    z[b == 0] = 0
    return z


def _person_json(p: Person) -> dict:
    return {
        "id": p.id,
        "box": [int(v) for v in p.box],
        "dist": round(float(p.dist), 2),
        "speed": round(float(p.speed), 2),
        "ttc": None if p.ttc is None else round(float(p.ttc), 2),
        "approaching": bool(p.approaching),
    }


def encode(seq: int, t_ms: int, fps: float, depth: np.ndarray, people: list[Person]) -> bytes:
    """1フレームを、[JSON の長さ uint32 LE][JSON][深度 uint8 × H × W] にする。"""
    if depth.shape != (H, W):
        raise ValueError(f"depth の形は {(H, W)} でなければならない: {depth.shape}")
    header = {
        "seq": seq,
        "t": t_ms,
        "w": W,
        "h": H,
        "fps": round(float(fps), 1),
        "people": [_person_json(p) for p in people],
    }
    body = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return _HEADER.pack(len(body)) + body + depth_to_u8(depth).tobytes()


@dataclass
class Decoded:
    header: dict
    depth: np.ndarray  # uint8 (H, W)


def decode(message: bytes) -> Decoded:
    """encode の逆。テストと確認用（ブラウザ側は web/src/protocol.ts）。"""
    (n,) = _HEADER.unpack_from(message, 0)
    header = json.loads(message[_HEADER.size : _HEADER.size + n].decode("utf-8"))
    depth = np.frombuffer(message, dtype=np.uint8, offset=_HEADER.size + n)
    if depth.size != header["w"] * header["h"]:
        raise ValueError(f"深度のバイト数が合わない: {depth.size}")
    return Decoded(header, depth.reshape(header["h"], header["w"]))
