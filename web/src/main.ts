// 画面の組み立て。/ws につながれば実データ、つながらなければデモデータ（仕様書 6章）。
// 共有ボタンは今のページのリンクを表示するだけ。QR コードは出さない。

// TODO: DepthView・Alarm・右側の欄・共有ボタン・接続状態をつなぐ
const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.textContent = "USHIROMI";
}
