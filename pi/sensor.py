"""Arducam ToF B0410 から深度・信頼度・振幅を読む（仕様書 M1）。

Far モード（4m）、240×180。SDK は ArducamDepthCamera（PyPI）。
使い方は公式の Python サンプル（https://github.com/ArduCAM/Arducam_tof_camera の example/python/preview_depth.py）に合わせている。
Pi では先に公式の Install_dependencies.sh を実行しておく（カメラのドライバー）。

SDK の生データを Frame に直す処理（make_frame）は、実機と録画の取り込み（import_test_data.py）で共通に使う。

  uv run sensor.py     # センサーだけを動かして、fps・距離・振幅を表示する（つながっているかの確認）
"""

import time

import numpy as np

from datatypes import H, W, Frame

# 実データ（test_data）で分かった、SDK の生データの癖（仕様書 11章「実データで分かったこと」）
DEPTH_SCALE = 0.001     # 深度は mm で来る → m に直す
ROTATE_180 = True       # 画像が上下逆さまで来る（センサーの付け方による。付け方を変えたらここを直す）
MIN_AMPLITUDE = 30.0    # 振幅がこれより弱い画素の深度はでたらめなので、測れない（0）にする（公式サンプルの初期値も 30）

RANGE_MM = 4000         # Far モード（2000 か 4000）
TIMEOUT_MS = 2000       # 1 フレームを待つ時間
MAX_MISSES = 5          # 続けてこの回数フレームが来なければ、止まったとみなす


def make_frame(depth_raw: np.ndarray, amplitude_raw: np.ndarray, t: float) -> Frame:
    """SDK の生データ（深度 mm・振幅）→ Frame（深度 m、向きを直し、弱い画素の深度は 0）。

    B0410 では confidence と amplitude が同じ値なので、両方に同じ振幅の配列を入れる（コピーしない。メモリ節約）。
    """
    depth = np.asarray(depth_raw, dtype=np.float32) * DEPTH_SCALE
    amplitude = np.asarray(amplitude_raw, dtype=np.float32)
    if depth.shape != (H, W) or amplitude.shape != (H, W):
        raise ValueError(f"画素数が {(H, W)} ではない: {depth.shape}, {amplitude.shape}")
    if ROTATE_180:
        depth, amplitude = depth[::-1, ::-1], amplitude[::-1, ::-1]
    depth = np.where(amplitude >= MIN_AMPLITUDE, depth, 0).astype(np.float32)
    amplitude = np.ascontiguousarray(amplitude)
    return Frame(depth=depth, confidence=amplitude, amplitude=amplitude, t=t)


class Sensor:
    def __init__(self) -> None:
        import ArducamDepthCamera as ac  # 実機のときだけ読み込む（偽データ・録画では使わない）

        self.ac = ac
        self.cam = ac.ArducamCamera()
        self.opened = False

    def open(self) -> None:
        """センサーを Far モード（4m）で開く。"""
        ac = self.ac
        if (ret := self.cam.open(ac.Connection.CSI, 0)) != 0:
            raise RuntimeError(f"センサーを開けない（エラー {ret}）。FPC と給電（GPIO の 5V・GND）、"
                               "公式の Install_dependencies.sh を実行したかを確かめる")
        if (ret := self.cam.start(ac.FrameType.DEPTH)) != 0:
            self.cam.close()
            raise RuntimeError(f"センサーを始められない（エラー {ret}）")
        self.opened = True
        self.cam.setControl(ac.Control.RANGE, RANGE_MM)
        info = self.cam.getCameraInfo()
        if (info.height, info.width) != (H, W):
            self.close()
            raise RuntimeError(f"画素数が {W}x{H} ではない: {info.width}x{info.height}")
        print(f"センサー：SDK {ac.__version__}、{info.width}x{info.height}、"
              f"範囲 {self.cam.getControl(ac.Control.RANGE)}mm", flush=True)

    def read(self) -> Frame:
        """次のフレームが来るまで待って返す。"""
        for _ in range(MAX_MISSES):
            frame = self.cam.requestFrame(TIMEOUT_MS)
            if frame is None:
                continue
            try:
                if not isinstance(frame, self.ac.DepthData):
                    continue
                # releaseFrame のあとは SDK の中の配列が使い回されるので、先に写しておく
                depth = np.array(frame.depth_data, dtype=np.float32, copy=True)
                amplitude = getattr(frame, "amplitude_data", None)
                if amplitude is None:
                    amplitude = frame.confidence_data
                amplitude = np.array(amplitude, dtype=np.float32, copy=True)
            finally:
                self.cam.releaseFrame(frame)
            return make_frame(depth, amplitude, t=time.monotonic())
        raise RuntimeError(f"センサーから {MAX_MISSES} 回続けてフレームが来ない")

    def close(self) -> None:
        if self.opened:
            self.cam.stop()
            self.cam.close()
            self.opened = False


def main() -> None:
    """センサーだけを動かして、つながっているかを確かめる（Ctrl+C で終了）。"""
    sensor = Sensor()
    sensor.open()
    try:
        count, start = 0, time.monotonic()
        while True:
            f = sensor.read()
            count += 1
            now = time.monotonic()
            if now - start >= 1.0:
                valid = f.depth[f.depth > 0]
                center = f.depth[H // 2 - 5 : H // 2 + 5, W // 2 - 5 : W // 2 + 5]
                center = center[center > 0]
                print(
                    f"{count / (now - start):4.1f} fps  測れた画素 {valid.size / f.depth.size:4.0%}  "
                    f"距離 {valid.min() if valid.size else 0:.2f}〜{valid.max() if valid.size else 0:.2f} m  "
                    f"中央 {np.median(center) if center.size else 0:.2f} m  振幅の最大 {f.amplitude.max():.0f}",
                    flush=True,
                )
                count, start = 0, now
    except KeyboardInterrupt:
        pass
    finally:
        sensor.close()


if __name__ == "__main__":
    main()
