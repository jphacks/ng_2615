"""録画の読み書き（仕様書 11章「録画ファイルの形式」）。

Pi はメモリが少ない（1GB）ので、録画中もフレームをためずに 1 枚ずつディスクに追記し、
再生も全部は読み込まず、ファイルをメモリに対応づけて（memmap）使う分だけ読む。

1 回の録画 = フォルダー 1 つ：
  depth.f16      深度 [m]、float16、(N, H, W) を順に追記
  amplitude.f16  振幅、float16、(N, H, W)（B0410 では confidence と同じ値なので 1 つだけ持つ）
  t.f64          時刻 [s]、float64、(N,)
  meta.json      fps・モード・メモなど
途中で止まっても、書けたフレームまでは読める（フレーム数はファイルの大きさから出す）。

以前の形式（.npz 1 ファイル）も読める（全部読み込むので、大きいものは Pi では避ける）。
"""

import json
from collections.abc import Iterable, Iterator
from pathlib import Path

import numpy as np

from datatypes import H, W, Frame

FRAME_BYTES = H * W * 2  # float16 1 枚分


class RecordingWriter:
    """フレームを 1 枚ずつ追記する。with で使う。"""

    def __init__(self, path: Path, meta: dict) -> None:
        self.path = path
        self.meta = dict(meta)
        self.count = 0
        path.mkdir(parents=True, exist_ok=True)
        self._depth = open(path / "depth.f16", "wb")
        self._amplitude = open(path / "amplitude.f16", "wb")
        self._t = open(path / "t.f64", "wb")
        self._write_meta()

    def append(self, frame: Frame) -> None:
        self._depth.write(np.ascontiguousarray(frame.depth, dtype=np.float16).tobytes())
        self._amplitude.write(np.ascontiguousarray(frame.amplitude, dtype=np.float16).tobytes())
        self._t.write(np.float64(frame.t).tobytes())
        self.count += 1

    def close(self, **meta) -> None:
        self.meta.update(meta)
        for f in (self._depth, self._amplitude, self._t):
            f.close()
        self._write_meta()

    def _write_meta(self) -> None:
        (self.path / "meta.json").write_text(
            json.dumps({**self.meta, "frames": self.count, "height": H, "width": W}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def __enter__(self) -> "RecordingWriter":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def save(path: Path, frames: Iterable[Frame], meta: dict) -> None:
    """frames を録画として書く（録画の取り込みやテスト用）。"""
    with RecordingWriter(path, meta) as w:
        for f in frames:
            w.append(f)
    if w.count == 0:
        raise ValueError("frames が空")


class Recording:
    def __init__(self, path: Path) -> None:
        if path.is_dir():
            self.meta: dict = json.loads((path / "meta.json").read_text(encoding="utf-8"))
            if (self.meta["height"], self.meta["width"]) != (H, W):
                raise ValueError(f"録画の画素数が {(H, W)} ではない")
            # 途中で止まった録画でも、3 つのファイルがそろっているフレームまで使う
            n = min(
                (path / "depth.f16").stat().st_size // FRAME_BYTES,
                (path / "amplitude.f16").stat().st_size // FRAME_BYTES,
                (path / "t.f64").stat().st_size // 8,
            )
            if n == 0:
                raise ValueError(f"録画が空: {path}")
            self.depth = np.memmap(path / "depth.f16", dtype=np.float16, mode="r", shape=(n, H, W))
            self.amplitude = np.memmap(path / "amplitude.f16", dtype=np.float16, mode="r", shape=(n, H, W))
            self.t = np.memmap(path / "t.f64", dtype=np.float64, mode="r", shape=(n,))
        else:
            data = np.load(path)  # 以前の形式（.npz）
            self.depth, self.amplitude, self.t = data["depth"], data["amplitude"], data["t"]
            self.meta = json.loads(str(data["meta"]))
            if self.depth.shape[1:] != (H, W):
                raise ValueError(f"録画の画素数が {(H, W)} ではない: {self.depth.shape[1:]}")

    def __len__(self) -> int:
        return len(self.t)

    def frame(self, i: int) -> Frame:
        amplitude = self.amplitude[i].astype(np.float32)
        return Frame(depth=self.depth[i].astype(np.float32), confidence=amplitude, amplitude=amplitude, t=float(self.t[i]))

    def __iter__(self) -> Iterator[Frame]:
        for i in range(len(self)):
            yield self.frame(i)
