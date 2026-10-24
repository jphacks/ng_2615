import numpy as np

import protocol
import recording
from datatypes import H, W
from fake_sensor import SCENARIO_LENGTH, FakeDetector, FakeSensor, scenario_distance


def read_all(sensor: FakeSensor, seconds: float):
    return [sensor.read() for _ in range(int(seconds * sensor.fps))]


def test_frames_have_the_agreed_shape_and_type():
    sensor = FakeSensor(realtime=False)
    sensor.open()
    f = sensor.read()
    for a in (f.depth, f.confidence, f.amplitude):
        assert a.shape == (H, W)
        assert a.dtype == np.float32
    assert ((f.depth == 0) | ((f.depth >= 0) & (f.depth <= 4.0))).all()


def test_person_gets_closer_then_leaves():
    """完了条件の流れ：ついてくる → 近づく → 遠ざかって消える。"""
    assert scenario_distance(1.0) == scenario_distance(3.0)
    assert scenario_distance(6.5) < scenario_distance(4.5)
    assert scenario_distance(9.0) > scenario_distance(7.5)
    assert scenario_distance(SCENARIO_LENGTH - 0.5) is None


def test_box_grows_as_person_approaches():
    sensor = FakeSensor(realtime=False)
    sensor.open()
    heights = {}
    for _ in range(int(7.0 * sensor.fps)):
        f = sensor.read()  # truth_boxes は直前に読んだフレームのものなので、1枚ずつ見る
        if sensor.truth_boxes:
            heights[round(f.t, 2)] = sensor.truth_boxes[0][3]
    assert heights[6.96] > heights[4.0] > 0


def test_person_depth_matches_scenario():
    sensor = FakeSensor(realtime=False)
    sensor.open()
    f = read_all(sensor, 2.0)[-1]
    x, y, w, h = sensor.truth_boxes[0]
    inside = f.depth[y : y + h, x : x + w]
    assert abs(np.median(inside[inside > 0]) - scenario_distance(f.t)) < 0.15


def test_fake_detector_returns_boxes_near_truth():
    sensor = FakeSensor(realtime=False)
    detector = FakeDetector(sensor, miss_rate=0.0)
    sensor.open()
    f = sensor.read()
    (tx, ty, _, _), (bx, by, _, _) = sensor.truth_boxes[0], detector.detect(f.amplitude)[0]
    assert abs(tx - bx) <= 2 and abs(ty - by) <= 2


def test_frame_can_be_encoded():
    sensor = FakeSensor(realtime=False)
    sensor.open()
    message = protocol.encode(0, 0, 25.0, sensor.read().depth, [])
    assert protocol.decode(message).depth.shape == (H, W)


def test_recording_round_trip_and_playback(tmp_path):
    sensor = FakeSensor(realtime=False)
    sensor.open()
    frames = read_all(sensor, 1.0)
    path = tmp_path / "rec.npz"
    recording.save(path, frames, {"fps": 25, "note": "test"})

    rec = recording.Recording(path)
    assert len(rec) == len(frames)
    assert rec.meta["note"] == "test"
    assert np.allclose(rec.frame(3).depth, frames[3].depth, atol=0.005)

    player = FakeSensor(recording=path, realtime=False)
    player.open()
    played = [player.read() for _ in range(len(frames) + 1)]
    assert played[-1].t > played[-2].t  # 繰り返しても時刻は進む
    assert player.truth_boxes == []
