"""スレッドB：振幅画像から人の BBOX を得る（仕様書 M2）。

モデルは YOLOX-Nano（YOLOX 公式の学習済みの重み、Apache 2.0）。重みは pi/models/ に置く（Git に入れない）。
既定は入力 256×192 で書き出し直したもの（公式の 416×416 より約 3.5 倍速い。センサーと同じ 4:3）。PC で一度だけ：
  uv run scripts/export_yolox_onnx.py          # → pi/models/yolox_nano_256x192.onnx
公式の 416×416 のもの（yolox_nano.onnx）もそのまま使える（入力の大きさはモデルから読む）。

前処理・後処理の考え方は YOLOX 公式の ONNX 推論サンプル（demo/ONNXRuntime/onnx_inference.py）に合わせている：
余白 114 で左上に寄せて正方形に拡大、正規化なし（0〜255 のまま）、出力をグリッドと stride で枠に戻す。
振幅画像は明るさの差がとても大きいので、平方根で明るさをそろえる（実データで 220/220 フレーム検出、仕様書 5章）。
"""

from pathlib import Path

import numpy as np
import onnxruntime as ort

from datatypes import H, W, Box

PERSON = 0          # COCO の person
NMS_IOU = 0.45
PAD_VALUE = 114
STRIDES = (8, 16, 32)
THREADS = 3         # Pi 4 は 4 コア。1 コアはスレッドA（30fps の取得・追跡・送信）とサーバーに残す


def to_gray(amplitude: np.ndarray) -> np.ndarray:
    """振幅 → 0〜255 の白黒画像。明るい上位 0.5% で頭打ちにし、平方根で暗い部分を持ち上げる。"""
    hi = max(float(np.percentile(amplitude, 99.5)), 1e-6)
    return (np.sqrt(np.clip(amplitude / hi, 0, 1)) * 255).astype(np.float32)


def letterbox(gray: np.ndarray, size: tuple[int, int]) -> tuple[np.ndarray, float]:
    """白黒画像 (H, W) → モデルの入力 (1, 3, 高さ, 幅)。縦横比を保って拡大・縮小し、余りは 114 で埋める。"""
    h, w = gray.shape
    in_h, in_w = size
    r = min(in_h / h, in_w / w)
    nh, nw = int(h * r), int(w * r)
    ys = np.minimum((np.arange(nh) / r).astype(int), h - 1)
    xs = np.minimum((np.arange(nw) / r).astype(int), w - 1)
    padded = np.full((3, in_h, in_w), PAD_VALUE, dtype=np.float32)
    padded[:, :nh, :nw] = gray[ys][:, xs]
    return padded[None], r


def _grid(size: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    in_h, in_w = size
    grids, strides = [], []
    for s in STRIDES:
        ny, nx = in_h // s, in_w // s
        yv, xv = np.meshgrid(np.arange(ny), np.arange(nx), indexing="ij")
        grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
        strides.append(np.full((ny * nx, 1), s))
    return np.concatenate(grids).astype(np.float32), np.concatenate(strides).astype(np.float32)


def nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
    """重なった枠のうち、スコアの高いものだけ残す。boxes は (N, 4) の x0, y0, x1, y1。"""
    area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i, rest = order[0], order[1:]
        keep.append(int(i))
        w = np.clip(np.minimum(boxes[i, 2], boxes[rest, 2]) - np.maximum(boxes[i, 0], boxes[rest, 0]), 0, None)
        h = np.clip(np.minimum(boxes[i, 3], boxes[rest, 3]) - np.maximum(boxes[i, 1], boxes[rest, 1]), 0, None)
        inter = w * h
        order = rest[inter / (area[i] + area[rest] - inter) < iou_threshold]
    return keep


def decode(output: np.ndarray, grid: np.ndarray, stride: np.ndarray, r: float, score_threshold: float) -> list[Box]:
    """モデルの出力 (N, 85) → 人の BBOX（センサー画素の x, y, w, h）。"""
    scores = output[:, 4] * output[:, 5 + PERSON]  # 物体らしさ × person の確からしさ
    keep = scores >= score_threshold
    if not keep.any():
        return []
    xy = (output[keep, :2] + grid[keep]) * stride[keep]
    wh = np.exp(output[keep, 2:4]) * stride[keep]
    boxes = np.concatenate([xy - wh / 2, xy + wh / 2], 1) / r
    result: list[Box] = []
    for i in nms(boxes, scores[keep], NMS_IOU):
        x0, y0, x1, y1 = boxes[i]
        x0, y0 = max(0, int(round(x0))), max(0, int(round(y0)))
        x1, y1 = min(W, int(round(x1))), min(H, int(round(y1)))
        if x1 > x0 and y1 > y0:
            result.append((x0, y0, x1 - x0, y1 - y0))
    return result


class Detector:
    def __init__(self, model_path: Path, score_threshold: float = 0.35, threads: int = THREADS) -> None:
        if not model_path.exists():
            raise SystemExit(f"モデルがありません: {model_path}\n作り方は pi/detect.py の先頭を見てください。")
        self.score_threshold = score_threshold
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # Pi はメモリが少ない（1GB）ので、作業用メモリを先にまとめて確保しない（少し遅くなる代わりに小さくなる）
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        self.session = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
        model_input = self.session.get_inputs()[0]
        self.input_name = model_input.name
        self.size = (model_input.shape[2], model_input.shape[3])  # (高さ, 幅)。既定のモデルは (192, 256)
        self.grid, self.stride = _grid(self.size)

    def detect(self, amplitude: np.ndarray) -> list[Box]:
        """振幅画像 float32 (H, W) → 人の BBOX の一覧（センサー画素）。"""
        x, r = letterbox(to_gray(amplitude), self.size)
        output = self.session.run(None, {self.input_name: x})[0][0]
        return decode(output, self.grid, self.stride, r, self.score_threshold)
