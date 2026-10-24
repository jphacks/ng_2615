"""距離・追跡・接近速度・TTC・接近判定（仕様書 M3〜M5）。"""

import numpy as np

from datatypes import Box, Person


class Tracker:
    def update(self, depth: np.ndarray, boxes: list[Box] | None, t: float) -> list[Person]:
        """毎フレーム呼ぶ。

        depth: float32 (H, W) [m]
        boxes: 検出の新しい結果。更新がないフレームは None（前回の枠を使い、距離だけ更新する）
        t: 取得時刻 [s]
        """
        # TODO: 距離（±0.4m の中央値）→ ID 付け（IoU 0.3）→ 速度（直近0.5秒の傾き）→ TTC → 判定
        raise NotImplementedError
