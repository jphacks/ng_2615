"""スレッドA（25fps）：取得 → 枠の追従 → 距離 → 追跡 → TTC → 送信。

スレッドB（DetectionWorker）は、最新の振幅画像に検出をかけて、BBOX を A に渡す。
A は検出を待たない。新しい枠がないフレームは、前回の枠のまま距離だけ更新する（仕様書 5章）。

  uv run main.py                       # 実機
  uv run main.py --fake                # センサーなし（合成データ＋偽の検出）
  uv run main.py --recording <path>    # 録画を再生（検出は --detector で選ぶ）
"""

import argparse
import socket
import threading
import time
from pathlib import Path

import numpy as np

import protocol
from datatypes import Box
from fake_sensor import FakeDetector, FakeSensor
from server import PORT, Server
from track import Tracker


class DetectionWorker(threading.Thread):
    """スレッドB。最新の振幅画像だけを検出にかける（間に合わなかった古い画像は捨てる）。"""

    def __init__(self, detector, max_fps: float) -> None:
        super().__init__(name="detect", daemon=True)
        self.detector = detector
        self.min_interval = 1 / max_fps if max_fps > 0 else 0
        self.detect_fps = 0.0
        self._lock = threading.Lock()
        self._has_image = threading.Event()
        self._image: np.ndarray | None = None
        self._boxes: list[Box] | None = None

    def submit(self, amplitude: np.ndarray) -> None:
        with self._lock:
            self._image = amplitude
        self._has_image.set()

    def take(self) -> list[Box] | None:
        """新しい検出結果があれば返す。なければ None（前回の枠を使う合図）。"""
        with self._lock:
            boxes, self._boxes = self._boxes, None
        return boxes

    def run(self) -> None:
        last = time.perf_counter()
        while True:
            self._has_image.wait()
            with self._lock:
                image, self._image = self._image, None
                self._has_image.clear()
            if image is None:
                continue
            boxes = self.detector.detect(image)
            with self._lock:
                self._boxes = boxes
            now = time.perf_counter()
            wait = self.min_interval - (now - last)
            if wait > 0:
                time.sleep(wait)
                now = time.perf_counter()
            self.detect_fps = 0.9 * self.detect_fps + 0.1 / max(now - last, 1e-6)
            last = now


def lan_ip() -> str | None:
    """同じ Wi-Fi の端末から開くときの、この機械の IP アドレス（Pi なら PC から開くのに使う）。"""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))  # 実際には何も送らない。外向きに使う IP を調べるだけ
            return s.getsockname()[0]
        except OSError:
            return None


def build(args: argparse.Namespace):
    if args.fake or args.recording:
        sensor = FakeSensor(recording=args.recording)
    else:
        from sensor import Sensor  # 実機のときだけ SDK を読み込む

        sensor = Sensor()

    if args.detector == "fake":
        if not isinstance(sensor, FakeSensor):
            raise SystemExit("--detector fake は --fake / --recording のときだけ使える")
        detector = FakeDetector(sensor)
    else:
        from detect import Detector

        detector = Detector(args.model)
    return sensor, detector


def main() -> None:
    parser = argparse.ArgumentParser(description="USHIROMI（Pi 側）")
    parser.add_argument("--fake", action="store_true", help="センサーなし（合成データ）")
    parser.add_argument("--recording", type=Path, help="録画（record.py で撮ったフォルダー、または以前の .npz）を再生する")
    parser.add_argument("--detector", choices=["fake", "yolox"], help="既定：--fake なら fake、それ以外は yolox")
    parser.add_argument("--model", type=Path, default=Path(__file__).parent / "models" / "yolox_nano_256x192.onnx")
    parser.add_argument("--detect-fps", type=float, default=5.0, help="検出の上限 fps（偽の検出を本物の速さに近づける）")
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()
    if args.detector is None:
        args.detector = "fake" if args.fake else "yolox"

    sensor, detector = build(args)
    server = Server(port=args.port)
    worker = DetectionWorker(detector, max_fps=args.detect_fps)
    tracker = Tracker()

    sensor.open()
    server.start()
    worker.start()
    print(f"ブラウザで開く：http://localhost:{server.port}/", flush=True)
    if (ip := lan_ip()) is not None:
        print(f"  同じ Wi-Fi の PC・スマホから：http://{ip}:{server.port}/", flush=True)
    print("（Ctrl+C で終了）", flush=True)

    seq = 0
    fps = 0.0
    proc_ms = 0.0
    prev_read = time.perf_counter()
    last_log = prev_read
    try:
        while True:
            frame = sensor.read()
            start = time.perf_counter()
            fps = 0.9 * fps + 0.1 / max(start - prev_read, 1e-6)
            prev_read = start

            worker.submit(frame.amplitude)
            people = tracker.update(frame.depth, worker.take(), frame.t)
            message = protocol.encode(seq, int(time.time() * 1000), fps, frame.depth, people)
            server.broadcast(message)
            seq += 1

            proc_ms = 0.9 * proc_ms + 0.1 * (time.perf_counter() - start) * 1000
            if start - last_log >= 1.0:
                last_log = start
                warn = [p.id for p in people if p.approaching]
                print(
                    f"fps {fps:4.1f}  処理 {proc_ms:4.1f}ms  検出 {worker.detect_fps:4.1f}fps  "
                    f"人 {len(people)}  接近 {warn or '-'}  ブラウザ {server.clients}",
                    flush=True,
                )
    except KeyboardInterrupt:
        pass
    finally:
        sensor.close()
        server.stop()


if __name__ == "__main__":
    main()
