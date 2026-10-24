"""スレッドB：振幅画像から人の BBOX を得る（仕様書 M2）。

モデルは仮で YOLOX-Nano（ONNX Runtime）。録画を見てから選ぶ。
前処理（正規化・余白）は train/ と同じにすること。
"""

from pathlib import Path

import numpy as np

from datatypes import Box


class Detector:
    def __init__(self, model_path: Path, score_threshold: float = 0.35) -> None:
        self.model_path = model_path
        self.score_threshold = score_threshold
        # TODO: onnxruntime.InferenceSession を作る

    def detect(self, amplitude: np.ndarray) -> list[Box]:
        """振幅画像 float32 (H, W) → 人の BBOX の一覧（センサー画素）。"""
        # TODO: 前処理 → 推論 → 後処理（person のみ、NMS）
        raise NotImplementedError
