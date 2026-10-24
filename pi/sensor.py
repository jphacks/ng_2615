"""Arducam ToF B0410 から深度・信頼度・振幅を読む（仕様書 M1）。

Far モード（4m）、25fps。
SDK の生データを Frame に直す処理（make_frame）は、実機と録画の取り込み（import_test_data.py）で共通に使う。
"""

import numpy as np

from datatypes import H, W, Frame

# 実データ（test_data）で分かった、SDK の生データの癖（仕様書 11章「実データで分かったこと」）
DEPTH_SCALE = 0.001     # 深度は mm で来る → m に直す
ROTATE_180 = True       # 画像が上下逆さまで来る（センサーの付け方による。付け方を変えたらここを直す）
MIN_AMPLITUDE = 30.0    # 振幅がこれより弱い画素の深度はでたらめなので、測れない（0）にする


def make_frame(depth_raw: np.ndarray, amplitude_raw: np.ndarray, t: float) -> Frame:
    """SDK の生データ（深度 mm・振幅）→ Frame（深度 m、向きを直し、弱い画素の深度は 0）。

    B0410 では confidence と amplitude が同じ値なので、両方に振幅を入れる。
    """
    depth = np.asarray(depth_raw, dtype=np.float32) * DEPTH_SCALE
    amplitude = np.asarray(amplitude_raw, dtype=np.float32)
    if depth.shape != (H, W) or amplitude.shape != (H, W):
        raise ValueError(f"画素数が {(H, W)} ではない: {depth.shape}, {amplitude.shape}")
    if ROTATE_180:
        depth, amplitude = depth[::-1, ::-1], amplitude[::-1, ::-1]
    depth = np.where(amplitude >= MIN_AMPLITUDE, depth, 0).astype(np.float32)
    amplitude = np.ascontiguousarray(amplitude)
    return Frame(depth=depth, confidence=amplitude.copy(), amplitude=amplitude, t=t)


class Sensor:
    def open(self) -> None:
        """センサーを Far モードで開く。"""
        # TODO: Arducam ToF SDK で開く
        raise NotImplementedError

    def read(self) -> Frame:
        """次のフレームが来るまで待って返す。"""
        # TODO: SDK から深度（mm）と振幅を取り、make_frame() に渡す
        raise NotImplementedError

    def close(self) -> None:
        # TODO
        raise NotImplementedError
