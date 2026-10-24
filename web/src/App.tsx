// 画面の組み立て（仕様書 6章）。
// 上部に警告の帯、左に深度ビュー、右に状態と人の一覧、右上に共有ボタン。

import { DepthView } from "./components/DepthView";
import { ShareButton } from "./components/ShareButton";
import { SidePanel } from "./components/SidePanel";
import { useFrameStream } from "./hooks/useFrameStream";

export function App() {
  const { frame, source } = useFrameStream();

  // TODO: 警告の帯（接近中の人がいるとき「WARNING 後方から接近」）、警告音のボタン、レイアウト
  return (
    <main>
      <header>
        <h1>USHIROMI</h1>
        <ShareButton />
      </header>
      <DepthView frame={frame} />
      <SidePanel frame={frame} source={source} />
    </main>
  );
}
