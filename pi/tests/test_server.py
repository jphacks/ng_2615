import asyncio

import aiohttp
import numpy as np

import protocol
from datatypes import H, W
from server import Server


def test_serves_web_and_streams_frames(tmp_path):
    (tmp_path / "index.html").write_text("<p>USHIROMI</p>", encoding="utf-8")
    server = Server(port=0, web_dist=tmp_path)
    server.start()
    message = protocol.encode(1, 0, 25.0, np.full((H, W), 2.0, dtype=np.float32), [])

    async def client():
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://127.0.0.1:{server.port}/") as res:
                assert "USHIROMI" in await res.text()
            async with session.ws_connect(f"http://127.0.0.1:{server.port}/ws") as ws:
                while server.clients == 0:
                    await asyncio.sleep(0.01)
                for _ in range(3):  # 古いフレームは捨てられても、最新は届く
                    server.broadcast(message)
                received = await asyncio.wait_for(ws.receive_bytes(), timeout=5)
                return protocol.decode(received)

    try:
        decoded = asyncio.run(client())
        assert decoded.header["seq"] == 1
        assert decoded.depth.shape == (H, W)
    finally:
        server.stop()


def test_explains_missing_build(tmp_path):
    server = Server(port=0, web_dist=tmp_path / "missing")
    server.start()

    async def client():
        async with aiohttp.ClientSession() as session:
            async with session.get(f"http://127.0.0.1:{server.port}/") as res:
                return res.status, await res.text()

    try:
        status, text = asyncio.run(client())
        assert status == 503
        assert "pnpm build" in text
    finally:
        server.stop()
