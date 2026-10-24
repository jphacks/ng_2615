"""HTTP（web/dist を配信）＋ WebSocket（/ws）。ポートは 8000（仕様書 M6）。"""

from pathlib import Path

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
PORT = 8000


class Server:
    def start(self) -> None:
        """別スレッドでサーバーを起動する。"""
        # TODO: / で WEB_DIST、/ws で WebSocket
        raise NotImplementedError

    def broadcast(self, message: bytes) -> None:
        """つながっている全ブラウザに送る。遅いブラウザは古いフレームを捨てる。"""
        # TODO
        raise NotImplementedError
