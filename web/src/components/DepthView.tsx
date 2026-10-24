// 2D 深度ビュー＋人の枠（仕様書 6章、M7・M8）。
// 近いほど黄緑、遠いほど青。4m 超・測れない画素は濃紺。接近中の人は赤。
// 25fps で描くので、React の再描画ではなく Canvas に直接描く。

import { useEffect, useRef } from "react";
import { H, W, type FrameMessage } from "../protocol";

export function DepthView({ frame }: { frame: FrameMessage | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !frame) return;
    // TODO: 深度を色に変えて描き、人ごとに枠の四隅・ID・距離・速度・TTC を描く
  }, [frame]);

  return <canvas ref={canvasRef} width={W} height={H} />;
}
