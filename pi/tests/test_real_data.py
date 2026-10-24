"""実データまわり：生データ → Frame の変換、test_data の読み込み、YOLO の前処理・後処理。

実データ（test_data.zip）は顔が写っているので Git に入れない。ここでは同じ形の小さな作り物で確かめる。
"""

from pathlib import Path

import numpy as np
import pytest

import detect
import import_test_data
from datatypes import H, W
from sensor import MIN_AMPLITUDE, make_frame

MODEL = Path(__file__).resolve().parents[1] / "models" / "yolox_nano.onnx"


def test_make_frame_converts_units_rotation_and_weak_pixels():
    depth_mm = np.zeros((H, W), dtype=np.float32)
    amp = np.full((H, W), MIN_AMPLITUDE, dtype=np.float32)
    depth_mm[0, 0] = 1500.0         # 左上 → 180° 回して右下へ
    depth_mm[0, 1] = 3000.0
    amp[0, 1] = MIN_AMPLITUDE - 1   # 弱い画素 → 測れない（0）
    f = make_frame(depth_mm, amp, t=1.0)
    assert f.depth.dtype == np.float32 and f.depth.shape == (H, W)
    assert f.depth[H - 1, W - 1] == pytest.approx(1.5)
    assert f.depth[H - 1, W - 2] == 0
    assert np.array_equal(f.confidence, f.amplitude)


def test_parse_test_data_format():
    """`1: {...}, 2: {...}` と、10 フレームごとの `}11: {` の区切りの両方を読める。"""
    row = ", ".join(["1000.0"] * W)
    arr = "[" + ", ".join(["[" + row + "]"] * H) + "]"
    frame = "{'depth': " + arr + ", 'confidence': " + arr + ", 'amplitude': " + arr + "}"
    text = f"1: {frame}, 2: {frame}11: {frame}" + "{}"
    frames = import_test_data.parse(text, fps=10)
    assert len(frames) == 3
    assert [f.t for f in frames] == pytest.approx([0.0, 0.1, 0.2])
    assert frames[0].depth[5, 5] == pytest.approx(1.0)


def test_letterbox_keeps_aspect_and_pads():
    gray = np.full((H, W), 200, dtype=np.float32)
    x, r = detect.letterbox(gray, 416)
    assert x.shape == (1, 3, 416, 416)
    assert r == pytest.approx(416 / W)
    assert x[0, 0, 0, 0] == 200 and x[0, 0, 415, 0] == detect.PAD_VALUE  # 下の余りは 114


def test_decode_returns_person_boxes_in_sensor_pixels():
    grid, stride = detect._grid(416)
    out = np.zeros((len(grid), 85), dtype=np.float32)
    out[:, 2:4] = -10  # 枠を小さく
    i = 52 * 10 + 20  # stride 8 のマス（x=20, y=10）。画像の端で枠が切れない位置
    out[i] = 0
    out[i, :2] = 0.5
    out[i, 2:4] = np.log(10)  # 幅・高さ 80px（入力の画素）
    out[i, 4], out[i, 5] = 0.9, 0.9
    boxes = detect.decode(out, grid, stride, r=416 / W, score_threshold=0.35)
    assert len(boxes) == 1
    x, y, w, h = boxes[0]
    assert w == pytest.approx(80 * W / 416, abs=1) and h == pytest.approx(80 * W / 416, abs=1)
    assert x + w / 2 == pytest.approx((20 + 0.5) * 8 * W / 416, abs=1)  # 中心がそのマスにある


def test_nms_keeps_best_of_overlapping():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=np.float32)
    assert detect.nms(boxes, np.array([0.5, 0.9, 0.7]), 0.45) == [1, 2]


@pytest.mark.skipif(not MODEL.exists(), reason="YOLOX のモデルがない（pi/detect.py の先頭の手順で取れる）")
def test_detector_runs_on_an_amplitude_image():
    d = detect.Detector(MODEL)
    assert d.size == 416
    boxes = d.detect(np.random.default_rng(0).random((H, W), dtype=np.float32) * 20)
    assert isinstance(boxes, list)
