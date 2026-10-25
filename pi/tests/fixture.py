"""Python と TS の両方で読む、通信形式の見本（fixtures/protocol/）を作る。

  uv run python -m tests.fixture   # 形式を変えたら作り直してコミットする

frame.bin  ：protocol.encode() の出力
frame.json ：frame.bin を読んだら出てくるはずの値（web/src/protocol.test.ts が使う）
"""

import json
from pathlib import Path

import numpy as np

import protocol
from datatypes import H, W, Person

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "protocol"

# (行, 列, 入れる深度 [m]) 境目の値を含める
SAMPLES = [
    (0, 0, 0.0),            # 測れない
    (0, 1, 0.3),            # 下限 → 1
    (0, 2, 4.0),            # 上限 → 255
    (0, 3, 4.01),           # 上限より遠い → 0
    (0, 4, 0.1),            # 下限より近い → 1
    (0, 5, float("nan")),   # 壊れた値 → 0
    (0, 6, 2.15),           # 真ん中 → 128
    (H - 1, W - 1, 1.0),    # 右下の隅（行ごと、左上からの並びの確認）
]

PEOPLE = [
    Person(id=2, box=(131, 38, 34, 97), dist=2.413, speed=1.0249, ttc=2.355, approaching=True),
    Person(id=5, box=(10, 60, 20, 60), dist=3.9, speed=-0.4, ttc=None, approaching=False),
]


def build() -> tuple[bytes, dict]:
    depth = np.zeros((H, W), dtype=np.float32)
    for r, c, z in SAMPLES:
        depth[r, c] = z
    message = protocol.encode(seq=1520, t_ms=1729760000123, fps=24.84, depth=depth, people=PEOPLE)
    decoded = protocol.decode(message)
    expected = {
        "header": decoded.header,
        "samples": [
            {"row": r, "col": c, "u8": int(decoded.depth[r, c])} for r, c, _ in SAMPLES
        ],
    }
    return message, expected


def main() -> None:
    message, expected = build()
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / "frame.bin").write_bytes(message)
    (FIXTURE_DIR / "frame.json").write_text(
        json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {FIXTURE_DIR}")


if __name__ == "__main__":
    main()
