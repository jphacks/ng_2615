// 右側の欄：状態（SAFE / WARNING）、検出中の人の一覧、処理速度（仕様書 6章）。

import type { FrameMessage } from "../protocol";

interface Props {
  frame: FrameMessage | null;
  warning: boolean;
  receivedFps: number | null;
}

export function SidePanel({ frame, warning, receivedFps }: Props) {
  const people = [...(frame?.people ?? [])].sort((a, b) => a.dist - b.dist);

  return (
    <aside className="side">
      <section className={`card status ${warning ? "status-warning" : "status-safe"}`}>
        <p className="label">状態</p>
        <p className="status-value">{warning ? "WARNING" : "SAFE"}</p>
        <p className="status-sub">{warning ? "後方から人が接近しています" : "接近している人はいません"}</p>
      </section>

      <section className="card">
        <p className="label">検出中の人（{people.length}）</p>
        {people.length === 0 ? (
          <p className="empty">いません</p>
        ) : (
          <ul className="people">
            {people.map((p) => (
              <li key={p.id} className={`person ${p.approaching ? "person-warning" : ""}`}>
                <span className="person-id">ID {p.id}</span>
                <span className="person-dist">{p.dist.toFixed(2)} m</span>
                <span className="person-meta">
                  {p.speed >= 0 ? "+" : ""}
                  {p.speed.toFixed(2)} m/s · TTC {p.ttc === null ? "—" : `${p.ttc.toFixed(1)} s`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stats">
        <p className="label">処理速度</p>
        <dl>
          <div>
            <dt>Pi</dt>
            <dd>{frame ? `${frame.fps.toFixed(1)} fps` : "—"}</dd>
          </div>
          <div>
            <dt>受信</dt>
            <dd>{receivedFps === null ? "—" : `${receivedFps} fps`}</dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}
