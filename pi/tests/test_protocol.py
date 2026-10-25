import json
import math

import numpy as np
import pytest

import protocol
from datatypes import H, W, Person
from tests import fixture


def test_depth_to_u8_boundaries():
    depth = np.array([0.0, 0.3, 4.0, 4.01, 0.1, np.nan, 2.15, -1.0], dtype=np.float32)
    assert protocol.depth_to_u8(depth).tolist() == [0, 1, 255, 0, 1, 0, 128, 0]


def test_u8_round_trip_error_is_within_one_step():
    z = np.linspace(0.3, 4.0, 1000, dtype=np.float32)
    back = protocol.u8_to_depth(protocol.depth_to_u8(z))
    step = (protocol.Z_MAX - protocol.Z_MIN) / 254
    assert np.max(np.abs(back - z)) <= step / 2 + 1e-6


def test_encode_decode_round_trip():
    depth = np.full((H, W), 2.0, dtype=np.float32)
    people = [Person(id=1, box=(1, 2, 3, 4), dist=2.0, speed=0.5, ttc=4.0, approaching=False)]
    decoded = protocol.decode(protocol.encode(7, 123, 25.0, depth, people))
    assert decoded.header == {
        "seq": 7, "t": 123, "w": W, "h": H, "fps": 25.0,
        "people": [{"id": 1, "box": [1, 2, 3, 4], "dist": 2.0, "speed": 0.5, "ttc": 4.0, "approaching": False}],
    }
    assert decoded.depth.shape == (H, W)
    assert math.isclose(float(protocol.u8_to_depth(decoded.depth)[0, 0]), 2.0, abs_tol=0.01)


def test_message_layout():
    message = protocol.encode(0, 0, 25.0, np.zeros((H, W), dtype=np.float32), [])
    n = int.from_bytes(message[:4], "little")
    assert json.loads(message[4 : 4 + n])["people"] == []
    assert len(message) == 4 + n + W * H


def test_wrong_shape_is_rejected():
    with pytest.raises(ValueError):
        protocol.encode(0, 0, 25.0, np.zeros((W, H), dtype=np.float32), [])


def test_fixture_is_up_to_date():
    """fixtures/protocol/ が今の encode と同じか。違ったら uv run python -m tests.fixture で作り直す。"""
    message, expected = fixture.build()
    assert (fixture.FIXTURE_DIR / "frame.bin").read_bytes() == message
    assert json.loads((fixture.FIXTURE_DIR / "frame.json").read_text(encoding="utf-8")) == expected
