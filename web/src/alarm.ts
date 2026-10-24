// 警告音（仕様書 6章、M8）。ボタンでオン。TTC が短いほどビープが速く高くなる。
// ブラウザの仕様で、ユーザーが操作するまで音は鳴らせないので、enable() はボタンの中で呼ぶ。

const MAX_TTC = 3.0; // これより長い TTC では鳴らさない（接近判定と同じ）

export class Alarm {
  private ctx: AudioContext | null = null;
  private ttc: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  get enabled(): boolean {
    return this.ctx !== null;
  }

  enable(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  disable(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.ctx?.close();
    this.ctx = null;
  }

  // 接近中の人のうち、一番短い TTC を渡す。null なら止める。
  update(minTtc: number | null): void {
    this.ttc = minTtc;
    if (this.ttc !== null && this.ctx && this.timer === undefined) this.loop();
  }

  private loop(): void {
    if (this.ttc === null || !this.ctx) {
      this.timer = undefined;
      return;
    }
    const u = Math.min(Math.max(this.ttc / MAX_TTC, 0), 1); // 0 = すぐぶつかる、1 = まだ余裕
    this.beep(1500 - 700 * u, 0.08);
    this.timer = setTimeout(() => this.loop(), 110 + 500 * u);
  }

  private beep(freq: number, seconds: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }
}
