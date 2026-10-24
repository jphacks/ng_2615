"""深度・信頼度・振幅を録画する（デモの予備・調整用）。

  uv run record.py --seconds 30 --note "後ろから近づいて止まる"
  uv run main.py --recording recordings/<できたファイル>.npz     # 録画を流す

出力は recordings/ に置く（Git に入れない。振幅には顔が写る）。形式は仕様書 11章（recording.save）。
録画中は全フレームをメモリに持つ（30 秒で約 200MB）。
"""

import argparse
import time
from datetime import datetime
from pathlib import Path

import recording
from sensor import MIN_AMPLITUDE, RANGE_MM, ROTATE_180, Sensor


def main() -> None:
    parser = argparse.ArgumentParser(description="センサーを録画する")
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--note", default="", help="何を撮ったか（例：後ろから近づいて止まる）")
    parser.add_argument("--out", type=Path, help="既定：recordings/<日時>.npz")
    args = parser.parse_args()
    out = args.out or Path(__file__).parent / "recordings" / f"{datetime.now():%Y%m%d-%H%M%S}.npz"

    sensor = Sensor()
    sensor.open()
    frames = []
    try:
        for i in range(3, 0, -1):
            print(f"{i}…", flush=True)
            time.sleep(1)
        print(f"録画中（{args.seconds:.0f} 秒、Ctrl+C で早めに止める）", flush=True)
        start = time.monotonic()
        while time.monotonic() - start < args.seconds:
            frames.append(sensor.read())
    except KeyboardInterrupt:
        pass
    finally:
        sensor.close()

    if not frames:
        raise SystemExit("1 フレームも取れなかった")
    t0 = frames[0].t
    for f in frames:
        f.t -= t0  # 録画の始まりを 0 秒にする
    fps = (len(frames) - 1) / max(frames[-1].t, 1e-6)
    recording.save(out, frames, {
        "fps": round(fps, 2), "range_mm": RANGE_MM, "rotate_180": ROTATE_180,
        "min_amplitude": MIN_AMPLITUDE, "note": args.note, "recorded_at": datetime.now().isoformat(),
    })
    print(f"{len(frames)} フレーム（{frames[-1].t:.1f} 秒、{fps:.1f} fps）を {out} に書きました")


if __name__ == "__main__":
    main()
