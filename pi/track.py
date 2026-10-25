"""距離・追跡・接近速度・TTC・接近判定（仕様書 M3〜M5、5章）。

walking skeleton 用の素直な実装。しきい値の調整やカルマンフィルタは、録画を使って #11・#12・#20 で行う。
"""

from collections import deque
from dataclasses import dataclass, field

import numpy as np

from datatypes import Box, Person

DIST_WINDOW = 0.4    # 距離：前回の距離 ±この範囲の画素だけ使う [m]
IOU_MIN = 0.3        # 追跡：同じ人とみなす枠の重なり
DIST_MATCH = 1.0     # 追跡：同じ人とみなす距離の差 [m]
MAX_AGE = 1.0        # 追跡：この秒数、検出されなければ消す（検出は 5fps なので、0.5 秒だと 2 回続けて見落とすだけで消えてしまう）
SPEED_WINDOW = 0.5   # 接近速度：直近この秒数の距離に直線を当てはめる
MIN_SPEED = 0.1      # 接近判定：この速さ以上で近づいていて（0 にしないのは、測った速さのノイズで鳴ったり止まったりしないため）
WARN_DIST = 3.5      # 接近判定：かつ、この距離以内 [m]
MAX_TTC = 3.0        # 接近判定：または、この TTC 以下 [s]（遠くても速く迫る人）


def iou(a: Box, b: Box) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    w = min(ax + aw, bx + bw) - max(ax, bx)
    h = min(ay + ah, by + bh) - max(ay, by)
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / (aw * ah + bw * bh - inter)


def _crop(depth: np.ndarray, box: Box, shrink: float = 0.0) -> np.ndarray:
    """枠の中の深度。shrink > 0 なら、その割合だけ内側に縮める（枠の中心付近）。"""
    x, y, w, h = box
    dx, dy = int(w * shrink / 2), int(h * shrink / 2)
    return depth[max(0, y + dy) : max(0, y + h - dy), max(0, x + dx) : max(0, x + w - dx)]


def first_distance(depth: np.ndarray, box: Box) -> float | None:
    """初回の距離：枠の中心付近（縦横半分）の有効な画素の中央値。"""
    pixels = _crop(depth, box, shrink=0.5)
    valid = pixels[pixels > 0]
    return float(np.median(valid)) if valid.size else None


def next_distance(depth: np.ndarray, box: Box, prev: float) -> float | None:
    """2回目以降の距離：枠の中の有効な画素のうち、前回の距離 ±DIST_WINDOW 以内の中央値。"""
    pixels = _crop(depth, box)
    near = pixels[(pixels > 0) & (np.abs(pixels - prev) <= DIST_WINDOW)]
    return float(np.median(near)) if near.size else None


def is_approaching(dist: float, speed: float, ttc: float | None) -> bool:
    """接近判定：近づいていて（速さ ≥ 0.1 m/s）、3.5m 以内か TTC 3 秒以下。

    3.5m 以内なら、ゆっくりでも近づいてくる人は全員知らせる。3.5m より遠くても、速く迫る人は TTC で知らせる。
    """
    if speed < MIN_SPEED:
        return False
    return dist <= WARN_DIST or (ttc is not None and ttc <= MAX_TTC)


@dataclass
class Track:
    id: int
    box: Box
    dist: float
    last_seen: float                          # 最後に検出と対応付いた時刻
    history: deque = field(default_factory=deque)  # (時刻, 距離)

    def speed(self) -> float:
        """直近 SPEED_WINDOW 秒の距離に直線を当てはめた傾き。近づくと正。"""
        if len(self.history) < 3:
            return 0.0
        t = np.array([h[0] for h in self.history])
        if t[-1] - t[0] < SPEED_WINDOW / 2:
            return 0.0
        z = np.array([h[1] for h in self.history])
        slope = np.polyfit(t - t[0], z, 1)[0]
        return float(-slope)


class Tracker:
    def __init__(self) -> None:
        self.tracks: list[Track] = []
        self._next_id = 1

    def update(self, depth: np.ndarray, boxes: list[Box] | None, t: float) -> list[Person]:
        """毎フレーム呼ぶ。

        depth: float32 (H, W) [m]
        boxes: 検出の新しい結果。更新がないフレームは None（前回の枠を使い、距離だけ更新する）
        t: 取得時刻 [s]
        """
        if boxes is not None:
            self._match(depth, boxes, t)

        for tr in self.tracks:
            z = next_distance(depth, tr.box, tr.dist)
            if z is not None:
                tr.dist = z
                tr.history.append((t, z))
            while tr.history and t - tr.history[0][0] > SPEED_WINDOW:
                tr.history.popleft()

        self.tracks = [tr for tr in self.tracks if t - tr.last_seen <= MAX_AGE]
        return [self._person(tr) for tr in self.tracks]

    def _match(self, depth: np.ndarray, boxes: list[Box], t: float) -> None:
        """新しい枠と今いる人を、枠の重なりと距離の近さで対応付ける（重なりの大きい順に貪欲に）。"""
        box_dist = [first_distance(depth, b) for b in boxes]
        pairs = []
        for i, b in enumerate(boxes):
            for j, tr in enumerate(self.tracks):
                score = iou(b, tr.box)
                close = box_dist[i] is None or abs(box_dist[i] - tr.dist) <= DIST_MATCH
                if score >= IOU_MIN and close:
                    pairs.append((score, i, j))
        used_boxes, used_tracks = set(), set()
        for _, i, j in sorted(pairs, reverse=True):
            if i in used_boxes or j in used_tracks:
                continue
            used_boxes.add(i)
            used_tracks.add(j)
            self.tracks[j].box = boxes[i]
            self.tracks[j].last_seen = t

        for i, b in enumerate(boxes):
            if i in used_boxes or box_dist[i] is None:
                continue
            self.tracks.append(Track(id=self._next_id, box=b, dist=box_dist[i], last_seen=t))
            self._next_id += 1

    @staticmethod
    def _person(tr: Track) -> Person:
        v = tr.speed()
        ttc = tr.dist / v if v > 0 else None
        return Person(
            id=tr.id,
            box=tr.box,
            dist=tr.dist,
            speed=v,
            ttc=ttc,
            approaching=is_approaching(tr.dist, v, ttc),
        )
