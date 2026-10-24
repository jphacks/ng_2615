// /ws につながれば実データ、つながらなければデモデータを返す（仕様書 6章）。

import { useState } from "react";
import type { FrameMessage } from "../protocol";

export type Source = "pi" | "demo";

export function useFrameStream(): { frame: FrameMessage | null; source: Source } {
  const [frame] = useState<FrameMessage | null>(null);
  const [source] = useState<Source>("demo");

  // TODO: WebSocket(`ws://${location.host}/ws`) に接続し、binaryType = "arraybuffer" で decode する
  //       つながらない・切れたら startDemo() に切り替える
  return { frame, source };
}
