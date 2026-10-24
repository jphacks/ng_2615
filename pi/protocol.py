"""Pi → ブラウザの WebSocket メッセージを作る（仕様書 4章）。

形式を変えるときは、仕様書 4章と web/src/protocol.ts も一緒に直す。
"""

import numpy as np

from datatypes import Person


def encode(seq: int, t_ms: int, fps: float, depth: np.ndarray, people: list[Person]) -> bytes:
    """1フレームを、[JSON の長さ uint32 LE][JSON][深度 uint8 × H × W] にする。"""
    # TODO
    raise NotImplementedError


def depth_to_u8(depth: np.ndarray) -> np.ndarray:
    """float32 [m] → uint8。0 = 測れない、1〜255 = 0.3〜4.0m。"""
    # TODO
    raise NotImplementedError
