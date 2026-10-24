"""パート間で受け渡す型（仕様書 3章）。

標準ライブラリの types と名前がぶつからないように datatypes.py にしている。
"""

from dataclasses import dataclass

import numpy as np

H, W = 180, 240  # センサーの画素数（行, 列）


@dataclass
class Frame:
    """sensor.read() / fake_sensor.read() が返す1フレーム。配列はすべて float32 (H, W)。"""

    depth: np.ndarray       # [m]、測れない画素は 0
    confidence: np.ndarray
    amplitude: np.ndarray
    t: float                # 取得時刻 [s]


Box = tuple[int, int, int, int]  # x, y, w, h（センサー画素）


@dataclass
class Person:
    """Tracker.update() が返す1人分の結果。"""

    id: int
    box: Box
    dist: float             # [m]
    speed: float            # [m/s]、近づくと正
    ttc: float | None       # [s]、近づいていなければ None
    approaching: bool
