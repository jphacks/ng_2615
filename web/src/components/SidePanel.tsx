// 右側の欄：状態（SAFE / WARNING）、検出中の人の一覧、処理速度、接続状態（仕様書 6章）。

import type { Source } from "../hooks/useFrameStream";
import type { FrameMessage } from "../protocol";

export function SidePanel({ frame, source }: { frame: FrameMessage | null; source: Source }) {
  // TODO: 状態・人の一覧・fps
  return (
    <aside>
      <p>{source === "pi" ? "Pi 接続中" : "デモデータ"}</p>
      <p>{frame ? `${frame.fps.toFixed(1)} fps` : "-"}</p>
    </aside>
  );
}
