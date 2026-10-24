"""Sensor（実機）を、SDK の作り物で確かめる。本物のセンサーがない PC でも動く。"""

import sys
import types

import numpy as np
import pytest

from datatypes import H, W
from sensor import ROTATE_180, Sensor


class FakeDepthData:
    def __init__(self, depth_mm, amplitude):
        self.depth_data = depth_mm
        self.confidence_data = amplitude
        self.amplitude_data = amplitude


def fake_sdk(frames, info=(W, H), open_ret=0):
    """ArducamDepthCamera の作り物。frames を順に返し、releaseFrame された数を数える。"""
    sdk = types.SimpleNamespace(
        __version__="test",
        Connection=types.SimpleNamespace(CSI=0),
        FrameType=types.SimpleNamespace(DEPTH=2),
        Control=types.SimpleNamespace(RANGE=0),
        DepthData=FakeDepthData,
        released=[],
        controls={},
    )

    class Camera:
        def open(self, conn, index):
            return open_ret

        def start(self, frame_type):
            return 0

        def setControl(self, key, value):
            sdk.controls[key] = value

        def getControl(self, key):
            return sdk.controls.get(key, 0)

        def getCameraInfo(self):
            return types.SimpleNamespace(width=info[0], height=info[1])

        def requestFrame(self, timeout):
            return frames.pop(0) if frames else None

        def releaseFrame(self, frame):
            sdk.released.append(frame)

        def stop(self):
            pass

        def close(self):
            pass

    sdk.ArducamCamera = Camera
    return sdk


@pytest.fixture
def install(monkeypatch):
    def _install(sdk):
        monkeypatch.setitem(sys.modules, "ArducamDepthCamera", sdk)
        return sdk
    return _install


def test_read_converts_and_releases(install):
    depth = np.full((H, W), 1500.0, dtype=np.float32)
    amp = np.full((H, W), 100.0, dtype=np.float32)
    amp[0, 0] = 5.0  # 弱い画素
    raw = FakeDepthData(depth, amp)
    sdk = install(fake_sdk([None, raw]))  # 1 回目は来ない、2 回目に来る
    s = Sensor()
    s.open()
    f = s.read()
    assert sdk.controls[0] == 4000  # Far モード
    assert f.depth.shape == (H, W) and f.depth.dtype == np.float32
    assert f.depth[10, 10] == pytest.approx(1.5)
    weak = (H - 1, W - 1) if ROTATE_180 else (0, 0)  # 向きの設定どおりの位置に来る
    assert f.depth[weak] == 0
    assert sdk.released == [raw]
    depth[:] = 0  # SDK が配列を使い回しても、返した Frame は変わらない
    assert f.depth[10, 10] == pytest.approx(1.5)
    s.close()


def test_read_gives_up_after_misses(install):
    install(fake_sdk([]))
    s = Sensor()
    s.open()
    with pytest.raises(RuntimeError, match="フレームが来ない"):
        s.read()


def test_open_explains_failure(install):
    install(fake_sdk([], open_ret=-1))
    with pytest.raises(RuntimeError, match="開けない"):
        Sensor().open()


def test_open_rejects_wrong_resolution(install):
    install(fake_sdk([], info=(640, 480)))
    with pytest.raises(RuntimeError, match="画素数"):
        Sensor().open()
