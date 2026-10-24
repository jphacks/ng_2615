"""もらった実データ（test_data.zip の test_data.json）を、録画形式（フォルダー。仕様書 11章）に変換する。

  uv run import_test_data.py ../test_data.zip                 # → recordings/test_data/
  uv run main.py --recording recordings/test_data             # 再生して http://localhost:8000/ で見る

test_data.json は JSON ではなく、Python の辞書を表示した文字列（`1: {'depth': [[...]], ...}, 2: {...}`）。
eval は使わず、フレームごとに切り出して数値だけを読む。
時刻が入っていないので、--fps（既定 25）で等間隔の時刻を付ける。
"""

import argparse
import re
import zipfile
from pathlib import Path

import numpy as np

import recording
from datatypes import Frame
from sensor import make_frame

# 10 フレームごとに区切りが `}, 11:` ではなく `}11:` になっているので、前が数字でも小数点でもない所で切る
FRAME_START = re.compile(r"(?<![\d.])(\d+): \{'depth'")


def read_text(path: Path) -> str:
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith(".json"))
            return z.read(name).decode("utf-8")
    return path.read_text(encoding="utf-8")


def parse_array(block: str, key: str) -> np.ndarray:
    """`'key': [[1.0, 2.0], [3.0, 4.0]]` → 2 次元の配列。"""
    head = f"'{key}': [["
    start = block.index(head) + len(head)
    end = block.index("]]", start)
    rows = block[start:end].split("], [")
    return np.array([np.array(row.split(", "), dtype=np.float32) for row in rows])


def parse(text: str, fps: float) -> list[Frame]:
    starts = [m.start() for m in FRAME_START.finditer(text)]
    if not starts:
        raise ValueError("フレームが見つからない（形式が違う）")
    frames = []
    for i, (s, e) in enumerate(zip(starts, starts[1:] + [len(text)])):
        block = text[s:e]
        frames.append(make_frame(parse_array(block, "depth"), parse_array(block, "amplitude"), t=i / fps))
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description="test_data を録画形式（フォルダー）に変換する")
    parser.add_argument("src", type=Path, help="test_data.zip か test_data.json")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "recordings" / "test_data")
    parser.add_argument("--fps", type=float, default=25.0, help="撮ったときの fps（データに時刻がないため）")
    args = parser.parse_args()

    frames = parse(read_text(args.src), args.fps)
    recording.save(args.out, frames, {"fps": args.fps, "source": args.src.name, "note": "fps は仮"})
    valid = np.mean([(f.depth > 0).mean() for f in frames])
    print(f"{len(frames)} フレームを {args.out} に書きました（測れた画素 平均 {valid:.0%}、{args.fps} fps と仮定）")


if __name__ == "__main__":
    main()
