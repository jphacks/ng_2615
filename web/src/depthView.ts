// 2D 深度ビュー＋人の枠（仕様書 6章、M7・M8）。
// 近いほど黄緑、遠いほど青。4m 超・測れない画素は濃紺。接近中の人は赤。

import type { FrameMessage } from "./protocol";

export class DepthView {
  constructor(private readonly canvas: HTMLCanvasElement) {}

  draw(_frame: FrameMessage): void {
    // TODO
    void this.canvas;
  }
}
