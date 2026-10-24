"""深度・振幅を録画する（デモの予備・調整用）。

  uv run record.py --seconds 30 --note "後ろから近づいて止まる"
  uv run main.py --recording recordings/<できたフォルダー>     # 録画を流す

出力は recordings/<日時>/ に置く（Git に入れない。振幅には顔が写る）。形式は仕様書 11章（recording.py）。
フレームはためずに 1 枚ずつディスクに追記するので、何分録ってもメモリは増えない（1 秒で約 4.3MB をディスクに書く）。
"""

import argparse
import time
from datetime import datetime
from pathlib import Path

from recording import RecordingWriter
from sensor import MIN_AMPLITUDE, RANGE_MM, ROTATE_180, Sensor


def main() -> None:
    parser = argparse.ArgumentParser(description="センサーを録画する")
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--note", default="", help="何を撮ったか（例：後ろから近づいて止まる）")
    parser.add_argument("--out", type=Path, help="既定：recordings/<日時>")
    args = parser.parse_args()
    out = args.out or Path(__file__).parent / "recordings" / f"{datetime.now():%Y%m%d-%H%M%S}"

    sensor = Sensor()
    sensor.open()
    meta = {"range_mm": RANGE_MM, "rotate_180": ROTATE_180, "min_amplitude": MIN_AMPLITUDE,
            "note": args.note, "recorded_at": datetime.now().isoformat()}
    writer = RecordingWriter(out, meta)
    t0 = None
    try:
        for i in range(3, 0, -1):
            print(f"{i}…", flush=True)
            time.sleep(1)
        print(f"録画中（{args.seconds:g} 秒、Ctrl+C で早めに止める）", flush=True)
        start = time.monotonic()
        while time.monotonic() - start < args.seconds:
            frame = sensor.read()
            t0 = frame.t if t0 is None else t0
            frame.t -= t0  # 録画の始まりを 0 秒にする
            writer.append(frame)
    except KeyboardInterrupt:
        pass
    finally:
        sensor.close()
        duration = frame.t if writer.count else 0.0
        fps = (writer.count - 1) / duration if writer.count > 1 and duration > 0 else 0.0
        writer.close(fps=round(fps, 2))

    if writer.count == 0:
        raise SystemExit("1 フレームも取れなかった")
    print(f"{writer.count} フレーム（{duration:.1f} 秒、{fps:.1f} fps）を {out} に書きました")


if __name__ == "__main__":
    main()
