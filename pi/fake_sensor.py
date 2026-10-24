"""Pi やセンサーがなくても全体を動かすための、Sensor の代わり。

録画ファイルの再生か、合成データ（近づいてくる人）を返す。
Sensor と同じ open / read / close を持つ。
"""

from pathlib import Path

from datatypes import Frame


class FakeSensor:
    def __init__(self, recording: Path | None = None, fps: float = 25.0) -> None:
        """recording を渡すと再生、None なら合成データを返す。"""
        self.recording = recording
        self.fps = fps

    def open(self) -> None:
        # TODO
        raise NotImplementedError

    def read(self) -> Frame:
        """fps に合わせて待ってから、次のフレームを返す。"""
        # TODO
        raise NotImplementedError

    def close(self) -> None:
        # TODO
        raise NotImplementedError
