"""Pi やセンサーがなくても全体を動かすための、Sensor と Detector の代わり。

FakeSensor：合成データ（仕様書 7章の完了条件の流れ）か、録画の再生を返す。
FakeDetector：合成データの人の枠を、揺れや抜けを付けて返す（YOLO の代わり）。

合成データはわざと汚してある（距離のノイズ、測れない画素、人の輪郭のでたらめな距離）。
きれいなデータに合わせて追跡を作り込まないようにするため。しきい値の調整は録画でやる。
"""

import math
import time
from pathlib import Path

import numpy as np

from datatypes import H, W, Box, Frame
from recording import Recording

# センサーの置き方（仕様書 10章）。値は合成データ用のおおよそ
FX = FY = 171.0             # 焦点距離 [px]（水平の視野 約 70°）
CX, CY = W / 2, H / 2
CAM_HEIGHT = 1.4            # 肩の高さ [m]
TILT = math.radians(10)     # 下向きの角度
Z_MAX = 4.0                 # Far モードの上限 [m]。これより遠い画素は測れない（0）

# 後ろの人との距離の流れ（仕様書 7章の完了条件）。(秒, 始めの距離, 終わりの距離)、None はいない
# 近づく場面のあとは毎回「止まる（装着者が 1.2 m/s で歩くので遠ざかる）→ 4m より遠くなって見えなくなる」
SCENARIO: list[tuple[float, float | None, float | None]] = [
    (4.0, 3.8, 3.8),    # 1. 同じ速さでついてくる → 白
    (3.4, 3.8, 1.1),    # 2. 早足で追いつく（0.8 m/s）→ 3.5m から赤
    (2.7, 1.1, 4.3),
    (1.5, None, None),
    (6.4, 4.0, 0.8),    # 3. ゆっくり近づく（0.5 m/s）→ 3.5m から赤（TTC が長くても）
    (2.9, 0.8, 4.3),
    (1.5, None, None),
    (5.0, 4.0, 3.0),    # 4. じわじわ寄ってくる（0.2 m/s）→ ゆっくりでも 3.5m から赤
    (1.0, 3.0, 4.2),
    (1.5, None, None),
    (2.7, 4.0, 0.76),   # 5. 速歩きで追い抜く（1.2 m/s）→ TTC 3 秒を切る 3.6m あたりから赤
    (2.9, 0.76, 4.3),
    (1.5, None, None),
    (1.3, 4.0, 0.75),   # 6. 走ってくる（2.5 m/s）→ 3.5m より遠くても TTC が短いので赤
    (2.9, 0.75, 4.3),
    (1.8, None, None),
]
SCENARIO_LENGTH = sum(d for d, _, _ in SCENARIO)


def scenario_distance(t: float) -> float | None:
    """時刻 t [s] での後ろの人までの距離 [m]。いなければ None。流れは繰り返す。"""
    t %= SCENARIO_LENGTH
    for duration, z0, z1 in SCENARIO:
        if t < duration:
            if z0 is None or z1 is None:
                return None
            return z0 + (z1 - z0) * t / duration
        t -= duration
    return None


def _row(height: float, z: float) -> float:
    """地面からの高さ height [m]、距離 z [m] の点が写る行。"""
    return CY + FY * math.tan(math.atan2(CAM_HEIGHT - height, z) - TILT)


def _ground_depth() -> np.ndarray:
    """地面だけが写っているときの深度 (H, W) [m]。"""
    rows = np.arange(H, dtype=np.float32)
    angle = TILT + np.arctan((rows - CY) / FY)  # 水平から下向きの角度
    with np.errstate(divide="ignore"):
        z = np.where(angle > 0, CAM_HEIGHT / np.sin(angle), 0.0)
    z[z > Z_MAX] = 0
    return np.repeat(z[:, None], W, axis=1).astype(np.float32)


class FakeSensor:
    def __init__(
        self,
        recording: Path | None = None,
        fps: float = 25.0,
        realtime: bool = True,
        seed: int = 0,
    ) -> None:
        """recording を渡すと再生、None なら合成データを返す。

        realtime=False にすると待たずに次々返す（テスト用）。
        """
        self.recording_path = recording
        self.fps = fps
        self.realtime = realtime
        self.rng = np.random.default_rng(seed)
        self.truth_boxes: list[Box] = []  # 直前のフレームでの人の本当の枠（合成データのときだけ）
        self._recording: Recording | None = None
        self._ground = _ground_depth()
        self._i = 0
        self._start = 0.0

    def open(self) -> None:
        if self.recording_path is not None:
            self._recording = Recording(self.recording_path)
            # 録画に撮ったときの fps が書いてあれば、その速さで流す（record.py は実測の fps を書く）
            self.fps = float(self._recording.meta.get("fps", self.fps))
        self._i = 0
        self._start = time.perf_counter()

    def read(self) -> Frame:
        """fps に合わせて待ってから、次のフレームを返す。"""
        if self.realtime:
            wait = self._start + self._i / self.fps - time.perf_counter()
            if wait > 0:
                time.sleep(wait)
        frame = self._read_recording() if self._recording else self._synthesize(self._i / self.fps)
        self._i += 1
        return frame

    def close(self) -> None:
        self._recording = None

    def _read_recording(self) -> Frame:
        rec = self._recording
        assert rec is not None
        n = len(rec)
        loop, i = divmod(self._i, n)
        frame = rec.frame(i)
        # 繰り返して再生しても時刻が戻らないようにする
        frame.t += loop * (float(rec.t[-1] - rec.t[0]) + 1 / self.fps)
        self.truth_boxes = []
        return frame

    def _synthesize(self, t: float) -> Frame:
        depth = self._ground.copy()
        refl = np.where(depth > 0, 0.3, 0.0).astype(np.float32)  # 地面の反射の強さ
        self.truth_boxes = []

        z = scenario_distance(t)
        if z is not None and z <= Z_MAX:
            x = 0.15 * math.sin(t * 0.8)  # 少し左右に揺れる
            box = self._draw_person(depth, refl, z, x)
            if box is not None:
                self.truth_boxes = [box]

        valid = depth > 0
        # 距離のノイズ（遠いほど大きい）と、ところどころ測れない画素
        depth[valid] += self.rng.normal(0, 0.01 + 0.005 * depth[valid]).astype(np.float32)
        dropout = self.rng.random(depth.shape) < 0.02
        depth[dropout] = 0
        depth[depth > Z_MAX] = 0

        amplitude = np.zeros_like(depth)
        valid = depth > 0
        amplitude[valid] = refl[valid] * 2000 / np.maximum(depth[valid], 0.3) ** 2
        amplitude += np.abs(self.rng.normal(0, 3, depth.shape)).astype(np.float32)
        confidence = amplitude.copy()
        confidence[~valid] = 0
        return Frame(depth=depth, confidence=confidence, amplitude=amplitude, t=t)

    def _draw_person(self, depth: np.ndarray, refl: np.ndarray, z: float, x: float) -> Box | None:
        """距離 z、横の位置 x の人（身長 1.7m）を描いて、その枠を返す。"""
        parts = [(0.0, 1.45, 0.45), (1.45, 1.7, 0.2)]  # (下の高さ, 上の高さ, 幅) 胴と頭
        xs, ys = [], []
        for bottom, top, width in parts:
            y0 = max(0, math.floor(_row(top, z)))
            y1 = min(H, math.ceil(_row(bottom, z)))
            x0 = max(0, math.floor(CX + FX * (x - width / 2) / z))
            x1 = min(W, math.ceil(CX + FX * (x + width / 2) / z))
            if y0 >= y1 or x0 >= x1:
                continue
            cols = np.arange(x0, x1)
            u = (cols - (x0 + x1 - 1) / 2) / max((x1 - x0) / 2, 1)  # -1〜1（体の中心で 0）
            body = (z - 0.1 * (1 - u**2)).astype(np.float32)  # 体の丸み：中心ほど近い
            depth[y0:y1, x0:x1] = body
            refl[y0:y1, x0:x1] = 0.5
            # 輪郭の画素は、人と背景の間のでたらめな距離になる（ToF の癖）
            for c in (x0, x1 - 1):
                edge = self.rng.random(y1 - y0) < 0.5
                depth[y0:y1, c][edge] = z + self.rng.random(edge.sum()).astype(np.float32) * 2
            xs += [x0, x1]
            ys += [y0, y1]
        if not xs:
            return None
        return (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))


class FakeDetector:
    """Detector の代わり。FakeSensor が知っている人の枠を、揺れと抜けを付けて返す。

    録画の再生中は本当の枠がないので、何も返さない。
    """

    def __init__(self, sensor: FakeSensor, jitter: int = 2, miss_rate: float = 0.1, seed: int = 1) -> None:
        self.sensor = sensor
        self.jitter = jitter
        self.miss_rate = miss_rate
        self.rng = np.random.default_rng(seed)

    def detect(self, amplitude: np.ndarray) -> list[Box]:
        boxes: list[Box] = []
        for x, y, w, h in self.sensor.truth_boxes:
            if self.rng.random() < self.miss_rate:
                continue
            dx, dy, dw, dh = self.rng.integers(-self.jitter, self.jitter + 1, 4)
            boxes.append((max(0, int(x + dx)), max(0, int(y + dy)), max(1, int(w + dw)), max(1, int(h + dh))))
        return boxes
