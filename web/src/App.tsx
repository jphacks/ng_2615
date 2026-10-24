// 画面の組み立て（仕様書 6章）。
// 上部に警告の帯、左に深度ビュー、右に状態と人の一覧、右上に接続状態と共有ボタン。

import { useEffect, useMemo, useState } from "react";
import { Alarm } from "./alarm";
import { DepthView } from "./components/DepthView";
import { ShareButton } from "./components/ShareButton";
import { SidePanel } from "./components/SidePanel";
import { useFrameStream } from "./hooks/useFrameStream";

export function App() {
  const { frame, source, receivedFps } = useFrameStream();
  const alarm = useMemo(() => new Alarm(), []);
  const [soundOn, setSoundOn] = useState(false);

  const approaching = frame?.people.filter((p) => p.approaching) ?? [];
  const warning = approaching.length > 0;
  const ttcs = approaching.map((p) => p.ttc).filter((t): t is number => t !== null);
  const minTtc = ttcs.length > 0 ? Math.min(...ttcs) : null;

  useEffect(() => alarm.update(approaching), [alarm, approaching]);
  useEffect(() => () => alarm.disable(), [alarm]);

  const toggleSound = () => {
    if (alarm.enabled) alarm.disable();
    else alarm.enable();
    setSoundOn(alarm.enabled);
  };

  return (
    <div className={`app ${warning ? "app-warning" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">USHIROMI</span>
          <span className="brand-sub">夜道の背後を見守る、第三の目</span>
        </div>
        <div className="topbar-actions">
          <span className={`badge ${source === "pi" ? "badge-pi" : "badge-demo"}`}>
            <span className="dot" />
            {source === "pi" ? "Pi 接続中" : "デモデータ"}
          </span>
          <button type="button" className={`button ${soundOn ? "button-on" : ""}`} onClick={toggleSound}>
            {soundOn ? "警告音 オン" : "警告音 オフ"}
          </button>
          <ShareButton />
        </div>
      </header>

      <main className="layout">
        <section className="card view">
          <div className="view-head">
            <p className="label">背後の深度（240×180）</p>
            <div className="legend">
              <span>0.3 m</span>
              <span className="legend-bar" />
              <span>4.0 m</span>
            </div>
          </div>
          <div className="view-frame">
            <DepthView frame={frame} />
            {/* 帯は深度ビューの上に重ねる（出たり消えたりしてもレイアウトが動かない） */}
            <div className={`banner ${warning ? "banner-show" : ""}`} role="alert">
              WARNING　後方から接近
              {minTtc !== null && <span className="banner-ttc">TTC {minTtc.toFixed(1)} s</span>}
            </div>
          </div>
        </section>
        <SidePanel frame={frame} warning={warning} receivedFps={receivedFps} />
      </main>
    </div>
  );
}
