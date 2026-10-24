"""HTTP（web/dist を配信）＋ WebSocket（/ws）。ポートは 8000（仕様書 M6）。

aiohttp を別スレッドの asyncio ループで動かす。main.py（スレッドA）は broadcast() を呼ぶだけ。
遅いブラウザには古いフレームを捨てて、最新の1枚だけを送る（表示と警告を遅らせないため）。
"""

import asyncio
import threading
from pathlib import Path

from aiohttp import WSMsgType, web

WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"
PORT = 8000


class Server:
    def __init__(self, port: int = PORT, web_dist: Path = WEB_DIST) -> None:
        self.port = port
        self.web_dist = web_dist
        self._loop = asyncio.new_event_loop()
        self._queues: set[asyncio.Queue[bytes]] = set()
        self._sockets: set[web.WebSocketResponse] = set()
        self._ready = threading.Event()
        self._runner: web.AppRunner | None = None
        self._thread = threading.Thread(target=self._run, name="server", daemon=True)

    @property
    def clients(self) -> int:
        return len(self._queues)

    def start(self) -> None:
        """別スレッドでサーバーを起動し、待ち受けが始まるまで待つ。"""
        self._thread.start()
        if not self._ready.wait(timeout=10):
            raise RuntimeError("サーバーが起動しない")

    def broadcast(self, message: bytes) -> None:
        """つながっている全ブラウザに送る。どのスレッドから呼んでもよい。"""
        self._loop.call_soon_threadsafe(self._fanout, message)

    def stop(self) -> None:
        """つながっているブラウザを先に閉じてから止める（閉じないと、ブラウザが切断に気づかない）。"""
        if self._runner is not None:
            asyncio.run_coroutine_threadsafe(self._shutdown(), self._loop).result(timeout=5)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5)

    async def _shutdown(self) -> None:
        for ws in list(self._sockets):
            await ws.close(code=1001, message=b"server stopped")
        assert self._runner is not None
        await self._runner.cleanup()

    def _fanout(self, message: bytes) -> None:
        for q in self._queues:
            if q.full():
                q.get_nowait()  # 送れていない古いフレームは捨てる
            q.put_nowait(message)

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._start_site())
        self._ready.set()
        self._loop.run_forever()

    async def _start_site(self) -> None:
        app = web.Application()
        app.router.add_get("/ws", self._ws)
        app.router.add_get("/{path:.*}", self._static)
        self._runner = web.AppRunner(app, shutdown_timeout=1)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "0.0.0.0", self.port)
        await site.start()
        if self.port == 0:  # テスト用：空いているポートを使ったとき、その番号を覚える
            self.port = self._runner.addresses[0][1]

    async def _static(self, request: web.Request) -> web.StreamResponse:
        if not (self.web_dist / "index.html").exists():
            return web.Response(status=503, text="web/dist がありません。web/ で pnpm build してください。")
        path = (self.web_dist / request.match_info["path"]).resolve()
        if path.is_file() and path.is_relative_to(self.web_dist.resolve()):
            return web.FileResponse(path)
        return web.FileResponse(self.web_dist / "index.html")

    async def _ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=10)
        await ws.prepare(request)
        queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=1)
        self._queues.add(queue)
        self._sockets.add(ws)

        async def send() -> None:
            while True:
                await ws.send_bytes(await queue.get())

        sender = asyncio.create_task(send())
        try:
            async for msg in ws:  # ブラウザからは送らない約束。閉じるのを待つだけ
                if msg.type == WSMsgType.ERROR:
                    break
        finally:
            sender.cancel()
            self._queues.discard(queue)
            self._sockets.discard(ws)
        return ws
