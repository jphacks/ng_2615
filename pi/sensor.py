"""Arducam ToF B0410 から深度・信頼度・振幅を読む（仕様書 M1）。

Far モード（4m）、25fps。
"""

from datatypes import Frame


class Sensor:
    def open(self) -> None:
        """センサーを Far モードで開く。"""
        # TODO: Arducam ToF SDK で開く
        raise NotImplementedError

    def read(self) -> Frame:
        """次のフレームが来るまで待って返す。"""
        # TODO: 深度・信頼度・振幅を float32 (H, W) にして返す
        raise NotImplementedError

    def close(self) -> None:
        # TODO
        raise NotImplementedError
