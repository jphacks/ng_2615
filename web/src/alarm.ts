// 警告音（仕様書 6章、M8）。ボタンでオン。TTC が短いほどビープが速く高くなる。
// ブラウザの仕様で、ユーザーが操作するまで音は鳴らせない。

export class Alarm {
  enable(): void {
    // TODO: AudioContext を作る
  }

  // 接近中の人のうち、一番短い TTC を渡す。null なら止める。
  update(_minTtc: number | null): void {
    // TODO
  }
}
