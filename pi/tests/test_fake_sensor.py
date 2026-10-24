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


def test_scenario_has_various_speeds():
    """ついてくる人と、いろいろな速さ（0.8・0.5・0.2・1.2・2.5 m/s）で近づく人が入っている。"""
    d = scenario_distance
    assert d(1.0) == d(3.0) == 3.8  # ついてくる
    assert d(6.5) < d(4.5)
    assert d(9.0) > d(7.5)  # 止まって遠ざかる
    assert d(11.0) is None  # 見えなくなる

    def speed(t0, t1):
        return (d(t0) - d(t1)) / (t1 - t0)

    assert abs(speed(4.5, 6.5) - 0.8) < 0.01
    assert abs(speed(13.0, 15.0) - 0.5) < 0.01
    assert abs(speed(23.0, 25.0) - 0.2) < 0.01
    assert abs(speed(30.5, 31.5) - 1.2) < 0.01
    assert abs(speed(37.2, 37.8) - 2.5) < 0.02
    assert d(SCENARIO_LENGTH - 0.5) is None


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
    path = tmp_path / "rec"
    recording.save(path, frames, {"fps": 25, "note": "test"})

    rec = recording.Recording(path)
    assert len(rec) == len(frames)
    assert rec.meta["note"] == "test" and rec.meta["frames"] == len(frames)
    assert isinstance(rec.depth, np.memmap)  # 全部は読み込まない
    assert np.allclose(rec.frame(3).depth, frames[3].depth, atol=0.005)

    player = FakeSensor(recording=path, realtime=False)
    player.open()
    played = [player.read() for _ in range(len(frames) + 1)]
    assert played[-1].t > played[-2].t  # 繰り返しても時刻は進む
    assert player.truth_boxes == []


def test_recording_survives_interruption(tmp_path):
    """録画が途中で止まって meta が古いままでも、書けたフレームまでは読める。"""
    sensor = FakeSensor(realtime=False)
    sensor.open()
    path = tmp_path / "rec"
    w = recording.RecordingWriter(path, {"note": "途中で止まる"})
    for _ in range(5):
        w.append(sensor.read())
    for f in (w._depth, w._amplitude, w._t):  # close() を呼ばずに止まったつもり
        f.flush()
    assert len(recording.Recording(path)) == 5


def test_old_npz_recordings_still_load(tmp_path):
    sensor = FakeSensor(realtime=False)
    sensor.open()
    frames = read_all(sensor, 0.2)
    path = tmp_path / "old.npz"
    np.savez(path, depth=np.stack([f.depth for f in frames]).astype(np.float16),
             confidence=np.stack([f.amplitude for f in frames]).astype(np.float16),
             amplitude=np.stack([f.amplitude for f in frames]).astype(np.float16),
             t=np.array([f.t for f in frames]), meta=np.array('{"fps": 25}'))
    rec = recording.Recording(path)
    assert len(rec) == len(frames) and rec.meta["fps"] == 25
