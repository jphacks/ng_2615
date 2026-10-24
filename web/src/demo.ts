// Pi につながらないときのデモデータ。protocol.ts の FrameMessage と同じ形で返す。

import type { FrameMessage } from "./protocol";

// 25fps で onFrame を呼ぶ。止めるときは戻り値の関数を呼ぶ。
export function startDemo(_onFrame: (frame: FrameMessage) => void): () => void {
  // TODO: 近づいてくる人の合成データ
  throw new Error("not implemented");
}
