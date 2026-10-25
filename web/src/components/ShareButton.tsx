// 共有ボタン（仕様書 M9）。押すと今開いているページのリンクを表示するだけ。
// QR コードは出さない（発表中に会場の人が読み込まないように）。

import { useEffect, useRef, useState } from "react";

export function ShareButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = location.href;
  const ref = useRef<HTMLDivElement>(null);

  // Esc か、外側を押したら閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // http の別端末からはクリップボードが使えないことがある。そのときは手で選んでコピーする
    }
  };

  return (
    <div className="share" ref={ref}>
      <button type="button" className="button" onClick={() => setOpen((v) => !v)}>
        共有
      </button>
      {open && (
        <div className="share-popover">
          <p className="share-title">このページのリンク</p>
          <div className="share-row">
            <input className="share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="button" onClick={copy}>
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <p className="share-note">同じ Wi-Fi の端末から開けます。</p>
        </div>
      )}
    </div>
  );
}
