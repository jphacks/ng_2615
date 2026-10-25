// /ws につながれば実データ、つながらなければデモデータを返す（仕様書 6章）。
// 切れたらデモデータに切り替え、裏で 2 秒ごとにつなぎ直す。

import { useEffect, useRef, useState } from "react";
import { startDemo } from "../demo";
import { decode, type FrameMessage } from "../protocol";

export type Source = "pi" | "demo";

const RETRY_MS = 2000;
const STALE_MS = 2000; // この間フレームが届かなければ、切れたとみなす（Wi-Fi が途切れたときなど）

export function useFrameStream(): { frame: FrameMessage | null; source: Source; receivedFps: number | null } {
  const [frame, setFrame] = useState<FrameMessage | null>(null);
  const [source, setSource] = useState<Source>("demo");
  const [receivedFps, setReceivedFps] = useState<number | null>(null); // 最初の 1 秒はまだ数えていない
  const count = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopDemo: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let lastMessage = 0;

    const onFrame = (f: FrameMessage) => {
      count.current++;
      setFrame(f);
    };

    const useDemo = () => {
      setSource("demo");
      stopDemo ??= startDemo(onFrame);
    };

    const connect = () => {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        lastMessage = performance.now();
        stopDemo?.();
        stopDemo = null;
        setSource("pi");
      };
      ws.onmessage = (e) => {
        lastMessage = performance.now();
        onFrame(decode(e.data as ArrayBuffer));
      };
      ws.onclose = () => {
        if (closed) return;
        useDemo();
        retry = setTimeout(connect, RETRY_MS);
      };
    };

    useDemo();
    connect();

    // 届いたフレームの数を 1 秒ごとに数える（右側の欄の「受信」）。あわせて止まった接続を見張る
    const meter = setInterval(() => {
      setReceivedFps(count.current);
      count.current = 0;
      if (ws?.readyState === WebSocket.OPEN && performance.now() - lastMessage > STALE_MS) ws.close();
    }, 1000);

    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(meter);
      ws?.close();
      stopDemo?.();
    };
  }, []);

  return { frame, source, receivedFps };
}
