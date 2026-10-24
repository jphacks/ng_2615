"""録画ファイルの読み書き（仕様書 11章「録画ファイルの形式」）。

1回の録画 = .npz 1ファイル。record.py が書き、fake_sensor.py が読む。
保存は float16（容量を半分にするため）、読むときに float32 に戻す。
"""

import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from datatypes import H, W, Frame


def save(path: Path, frames: list[Frame], meta: dict) -> None:
    """frames をまとめて1ファイルに書く。meta には fps・モード・装着の角度・メモなどを入れる。"""
    if not frames:
        raise ValueError("frames が空")
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        path,
        depth=np.stack([f.depth for f in frames]).astype(np.float16),
        confidence=np.stack([f.confidence for f in frames]).astype(np.float16),
        amplitude=np.stack([f.amplitude for f in frames]).astype(np.float16),
        t=np.array([f.t for f in frames], dtype=np.float64),
        meta=np.array(json.dumps(meta, ensure_ascii=False)),
    )


class Recording:
    def __init__(self, path: Path) -> None:
        data = np.load(path)
        self.depth = data["depth"]
        self.confidence = data["confidence"]
        self.amplitude = data["amplitude"]
        self.t = data["t"]
        self.meta: dict = json.loads(str(data["meta"]))
        if self.depth.shape[1:] != (H, W):
            raise ValueError(f"録画の画素数が {(H, W)} ではない: {self.depth.shape[1:]}")

    def __len__(self) -> int:
        return len(self.t)

    def frame(self, i: int) -> Frame:
        return Frame(
            depth=self.depth[i].astype(np.float32),
            confidence=self.confidence[i].astype(np.float32),
            amplitude=self.amplitude[i].astype(np.float32),
            t=float(self.t[i]),
        )

    def __iter__(self) -> Iterator[Frame]:
        for i in range(len(self)):
            yield self.frame(i)
