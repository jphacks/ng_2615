"""距離・追跡・接近速度・TTC・接近判定（仕様書 M3〜M5、5章）。

距離と枠は、人の動きを想定した等速モデルのカルマンフィルタでならす（#20）。
距離は毎フレーム測れるので、速さもそのフィルタから出す。枠は検出（5fps）のときだけ測れるので、
あいだのフレームは動きを先読みして枠を動かす。

カルマンフィルタは追跡の補助。表示と警告は、いま検出されている人（SHOW_AGE 以内）だけ。
見えなくなった人も予測だけは続け（不確かさが大きくなっていく）、その不確かさの分だけ広く探して、また検出されたらつなぐ。
"""

from dataclasses import dataclass

import numpy as np

from datatypes import Box, Person

DIST_WINDOW = 0.4    # 距離：予測した距離 ±（これ＋予測の不確かさの 3 倍）の画素だけ使う [m]
# 追跡はゆるくつなぐ。同時に映るのはほぼ 1 人なので、同じ人を別人にしてしまうほうが困る
DIST_MATCH = 1.5     # 追跡：同じ人とみなす距離の差 [m]（＋予測の不確かさの 3 倍）
CENTER_MATCH = 1.0   # 追跡：枠が重ならなくても、中心のずれが枠の大きさのこの倍以内（＋予測の不確かさの 3 倍）なら同じ人とみなす
SHOW_AGE = 0.5       # 表示と警告：最後に検出されてからこの秒数以内の人だけ（検出は 5fps なので、1 回見落とすまでは出し続ける）
MAX_AGE = 2.0        # 追跡：この秒数、検出されなければ忘れる。それまでは表示も警告もしないが、また検出されたら同じ人としてつなぐ
DIST_NOISE = 0.05    # 距離フィルタ：1 フレームの距離の測りのばらつき [m]
DIST_ACCEL = 2.0     # 距離フィルタ：人の速さの変わりやすさ [m/s²]（歩く・止まる・走り出す）
BOX_NOISE = 6.0      # 枠フィルタ：検出の枠のばらつき [px]
BOX_ACCEL = 150.0    # 枠フィルタ：枠の動きの変わりやすさ [px/s²]
MAX_SPEED = 4.0      # 人の速さの上限 [m/s]。予測がどこまでも流れないように、これで頭打ち
SPEED_SURE = 0.35    # 速さの不確かさ（標準偏差）がこれより大きいうちは速さを 0 とする [m/s]。現れた直後は約 0.17 秒
                     # （ついてくるだけの人で鳴らないように。大きいと走ってくる人の警告が遅れる）
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


def next_distance(depth: np.ndarray, box: Box, prev: float, window: float = DIST_WINDOW) -> float | None:
    """2回目以降の距離：枠の中の有効な画素のうち、予測した距離 ±window 以内の中央値。"""
    pixels = _crop(depth, box)
    near = pixels[(pixels > 0) & (np.abs(pixels - prev) <= window)]
    return float(np.median(near)) if near.size else None


def is_approaching(dist: float, speed: float, ttc: float | None) -> bool:
    """接近判定：近づいていて（速さ ≥ 0.1 m/s）、3.5m 以内か TTC 3 秒以下。

    3.5m 以内なら、ゆっくりでも近づいてくる人は全員知らせる。3.5m より遠くても、速く迫る人は TTC で知らせる。
    """
    if speed < MIN_SPEED:
        return False
    return dist <= WARN_DIST or (ttc is not None and ttc <= MAX_TTC)


class ConstantVelocity:
    """等速モデルのカルマンフィルタ。値ごとに独立に、位置と速さを持つ。

    速さの変わり方（加速度）を白色ノイズとみなす。accel が大きいほど新しい測定にすぐ追いつき、小さいほどならす。
    """

    def __init__(self, z, noise: float, accel: float, speed_spread: float) -> None:
        self.x = np.array(z, dtype=float)       # 位置
        self.v = np.zeros_like(self.x)          # 速さ
        self.pxx = np.full_like(self.x, noise**2)  # 共分散（位置・位置、位置・速さ、速さ・速さ）
        self.pxv = np.zeros_like(self.x)
        self.pvv = np.full_like(self.x, speed_spread**2)
        self.r = noise**2
        self.q = accel**2

    def predict(self, dt: float) -> None:
        if dt <= 0:
            return
        self.x = self.x + self.v * dt
        self.pxx = self.pxx + 2 * dt * self.pxv + dt * dt * self.pvv + self.q * dt**4 / 4
        self.pxv = self.pxv + dt * self.pvv + self.q * dt**3 / 2
        self.pvv = self.pvv + self.q * dt**2

    def update(self, z) -> None:
        s = self.pxx + self.r
        kx, kv = self.pxx / s, self.pxv / s
        e = np.asarray(z, dtype=float) - self.x
        self.x = self.x + kx * e
        self.v = self.v + kv * e
        self.pvv = self.pvv - kv * self.pxv
        self.pxv = self.pxv - kv * self.pxx
        self.pxx = self.pxx - kx * self.pxx


def _box_state(box: Box) -> np.ndarray:
    x, y, w, h = box
    return np.array([x + w / 2, y + h / 2, w, h], dtype=float)


@dataclass
class Track:
    id: int
    dist_kf: ConstantVelocity                 # 距離（1 個）
    box_kf: ConstantVelocity                  # 枠の中心 x・y と幅・高さ（4 個）
    t: float                                  # フィルタを進めた時刻
    last_seen: float                          # 最後に検出と対応付いた時刻

    def visible(self, t: float) -> bool:
        """いま検出されている（表示と警告の対象）。"""
        return t - self.last_seen <= SHOW_AGE

    @classmethod
    def start(cls, id: int, box: Box, dist: float, t: float) -> "Track":
        return cls(
            id=id,
            dist_kf=ConstantVelocity([dist], DIST_NOISE, DIST_ACCEL, speed_spread=1.0),
            box_kf=ConstantVelocity(_box_state(box), BOX_NOISE, BOX_ACCEL, speed_spread=50.0),
            t=t,
            last_seen=t,
        )

    @property
    def dist(self) -> float:
        return float(self.dist_kf.x[0])

    @property
    def box(self) -> Box:
        cx, cy, w, h = self.box_kf.x
        w, h = max(1.0, w), max(1.0, h)
        return (int(round(cx - w / 2)), int(round(cy - h / 2)), int(round(w)), int(round(h)))

    def dist_spread(self) -> float:
        """予測した距離の不確かさ（標準偏差）[m]。見えない間は大きくなっていく。"""
        return float(np.sqrt(self.dist_kf.pxx[0]))

    def center_spread(self) -> float:
        """予測した枠の中心の不確かさ（標準偏差）[px]。"""
        return float(np.sqrt(self.box_kf.pxx[:2].max()))

    def speed(self) -> float:
        """距離フィルタの速さ。近づくと正。まだ定まっていなければ 0。"""
        if np.sqrt(self.dist_kf.pvv[0]) > SPEED_SURE:
            return 0.0
        return float(-self.dist_kf.v[0])

    def predict(self, t: float) -> None:
        self.dist_kf.predict(t - self.t)
        self.box_kf.predict(t - self.t)
        self.dist_kf.v = np.clip(self.dist_kf.v, -MAX_SPEED, MAX_SPEED)
        self.t = t

    def measure_dist(self, z: float) -> None:
        self.dist_kf.update([z])
        self.dist_kf.v = np.clip(self.dist_kf.v, -MAX_SPEED, MAX_SPEED)


class Tracker:
    def __init__(self) -> None:
        self.tracks: list[Track] = []
        self._next_id = 1

    def update(self, depth: np.ndarray, boxes: list[Box] | None, t: float) -> list[Person]:
        """毎フレーム呼ぶ。

        depth: float32 (H, W) [m]
        boxes: 検出の新しい結果。更新がないフレームは None（枠は先読みし、距離だけ測る）
        t: 取得時刻 [s]
        """
        for tr in self.tracks:
            tr.predict(t)
        if boxes is not None:
            self._match(depth, boxes, t)

        for tr in self.tracks:
            if not tr.visible(t):
                continue  # 枠は予測だけなので、測らない
            z = next_distance(depth, tr.box, tr.dist, DIST_WINDOW + 3 * tr.dist_spread())
            if z is not None:
                tr.measure_dist(z)

        self.tracks = [tr for tr in self.tracks if t - tr.last_seen <= MAX_AGE]
        return [self._person(tr) for tr in self.tracks if tr.visible(t)]

    def _match(self, depth: np.ndarray, boxes: list[Box], t: float) -> None:
        """新しい枠と今いる人（先読みした枠）を対応付ける。人は 1〜2 人なので、近い組から貪欲に決める。

        枠が重なっているか中心が近く、距離の差が DIST_MATCH 以内なら同じ人とみなす。
        どちらも予測の不確かさの分だけ広げる（しばらく見えていなかった人ほど広く探す）。
        """
        box_dist = [first_distance(depth, b) for b in boxes]
        pairs = []
        for i, b in enumerate(boxes):
            for j, tr in enumerate(self.tracks):
                if box_dist[i] is not None and abs(box_dist[i] - tr.dist) > DIST_MATCH + 3 * tr.dist_spread():
                    continue
                score = iou(b, tr.box)
                if score == 0:
                    (bx, by, bw, bh), (tx, ty, tw, th) = b, tr.box
                    gap = np.hypot(bx + bw / 2 - tx - tw / 2, by + bh / 2 - ty - th / 2)
                    if gap > CENTER_MATCH * max(tw, th) + 3 * tr.center_spread():
                        continue
                    score = -gap  # 重なっている組を先に決める
                pairs.append((score, i, j))
        used_boxes, used_tracks = set(), set()
        for _, i, j in sorted(pairs, reverse=True):
            if i in used_boxes or j in used_tracks:
                continue
            used_boxes.add(i)
            used_tracks.add(j)
            self.tracks[j].box_kf.update(_box_state(boxes[i]))
            self.tracks[j].last_seen = t

        for i, b in enumerate(boxes):
            if i in used_boxes or box_dist[i] is None:
                continue
            self.tracks.append(Track.start(self._next_id, b, box_dist[i], t))
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
