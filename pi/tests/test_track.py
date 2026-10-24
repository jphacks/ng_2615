import numpy as np

from datatypes import H, W
from fake_sensor import FakeDetector, FakeSensor
from track import Tracker, iou


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


def test_follows_completion_conditions():
    """仕様書 7章の完了条件：ついてくる → 白、追いつく → 赤、止まる → 白。"""
    r = run_scenario(10.0)
    follow = r[3.0][0]
    assert not follow.approaching
    assert abs(follow.dist - 3.5) < 0.15
    assert abs(follow.speed) < 0.2

    closing = r[6.6][0]
    assert closing.approaching
    assert 0.6 < closing.speed < 1.0  # 本当は 0.8 m/s
    assert closing.ttc is not None and closing.ttc <= 3.0

    leaving = r[8.6][0]
    assert not leaving.approaching
    assert leaving.speed < 0
    assert leaving.ttc is None


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
