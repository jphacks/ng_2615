import numpy as np

from datatypes import H, W
from fake_sensor import FakeDetector, FakeSensor
from track import Tracker, iou, is_approaching


def run_scenario(seconds: float, detect_every: int = 5):
    """合成データを流して、時刻ごとの追跡結果を返す。検出は5フレームに1回（5fps 相当）。"""
    sensor = FakeSensor(realtime=False)
    detector = FakeDetector(sensor)
    tracker = Tracker()
    sensor.open()
    results = {}
    for i in range(int(seconds * sensor.fps)):
        f = sensor.read()
        boxes = detector.detect(f.amplitude) if i % detect_every == 0 else None
        results[round(f.t, 2)] = tracker.update(f.depth, boxes, f.t)
    return results


def test_iou():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1
    assert iou((0, 0, 10, 10), (20, 20, 5, 5)) == 0
    assert abs(iou((0, 0, 10, 10), (5, 0, 10, 10)) - 1 / 3) < 1e-9


def test_follower_never_rings():
    """同じ距離（3.8m）でついてくるだけの人は、速さのノイズがあっても鳴らない。"""
    r = run_scenario(4.0)
    followers = [p for t, people in r.items() if t >= 0.5 for p in people]
    assert followers and not any(p.approaching for p in followers)
    assert all(abs(p.speed) < 0.1 for p in followers)
    assert abs(followers[-1].dist - 3.8) < 0.15


def test_each_speed_rings_from_about_3_5m():
    """いろいろな速さで近づく人：3.5m より遠いうちは白（速い人を除く）、3.5m 以内に入ったら全員赤。"""
    r = run_scenario(38.0)

    fast = r[6.0][0]  # 0.8 m/s、約 1.9m
    assert fast.approaching and 0.6 < fast.speed < 1.0
    leaving = r[8.6][0]  # 止まって遠ざかる
    assert not leaving.approaching and leaving.speed < 0 and leaving.ttc is None
    assert r[11.0] == []  # 見えなくなって消えた

    slow_far, slow_in = r[12.4][0], r[14.0][0]  # 0.5 m/s、約 3.6m → 約 2.8m（現れてすぐは速さがまだ出ないので少し待つ）
    assert not slow_far.approaching and 0.35 < slow_far.speed < 0.65
    assert slow_in.approaching and slow_in.ttc is not None and slow_in.ttc > 3.0  # TTC が長くても鳴る

    creep_far, creep_in = r[24.0][0], r[26.52][0]  # 0.2 m/s、約 3.7m → 約 3.2m
    assert not creep_far.approaching
    assert creep_in.approaching and 0.1 <= creep_in.speed < 0.35  # ゆっくりでも鳴る

    walk = r[31.0][0]  # 1.2 m/s、約 2.7m
    assert walk.approaching and 1.0 < walk.speed < 1.4

    run = r[37.6][0]  # 2.5 m/s、約 2.5m
    assert run.approaching and run.speed > 1.8


def test_is_approaching():
    assert not is_approaching(dist=2.0, speed=0.05, ttc=40.0)  # 止まっている（ノイズ程度）
    assert not is_approaching(dist=2.0, speed=-1.0, ttc=None)  # 遠ざかっている
    assert is_approaching(dist=3.4, speed=0.2, ttc=17.0)  # 3.5m 以内なら、ゆっくりでも鳴る
    assert not is_approaching(dist=3.8, speed=0.5, ttc=7.6)  # 3.5m より遠く、TTC も長い
    assert is_approaching(dist=3.9, speed=1.5, ttc=2.6)  # 遠くても速く迫る


def test_same_id_while_following():
    r = run_scenario(4.0)
    ids = {p.id for t, people in r.items() if t >= 0.5 for p in people}
    assert ids == {1}


def test_person_is_removed_after_disappearing():
    r = run_scenario(12.0)
    assert r[11.0] == []


def test_no_boxes_means_no_people():
    tracker = Tracker()
    assert tracker.update(np.zeros((H, W), dtype=np.float32), [], 0.0) == []
