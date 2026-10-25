// 警告音（仕様書 6章、M8）。ボタンでオン。接近中の人がいる間鳴り、近いほど警告が強くなる。
// ブラウザの仕様で、ユーザーが操作するまで音は鳴らせないので、enable() はボタンの中で呼ぶ。
//
// 鳴り方：警告が始まった瞬間にサイレンのように上がる音を1回、そのあと高い音と低い音を交互に鳴らす
// （救急車や警報機のような「ピー・ポー」）。2つの音は、聞いていて落ち着かない音程（増4度）にしている。
//
// 強さ（危険度 0〜1）は距離で決める：3.5m で 0、0m で 1 のグラデーション。
// ただし遠くても速く迫る人のために、TTC による危険度（TTC 3秒で 0、0秒で 1）も見て、大きい方を使う。
//   3.5m → 2m：ゆっくりした「ピー・ポー」、控えめ
//   2m → 1m：だんだん速く、高く、鋭く、大きく
//   1m 未満 ：隙間なく鳴り続け、わずかにずらした音を重ねてざらつかせる（はっきり音の質が変わる）
//
// 鳴り始めは小さく、約1秒かけて大きくする（フェードイン）。腕を一瞬振ったような誤検知で驚かせないため。
// 音量は「危険度で決まる音量 × フェード」。止まってもすぐ（1秒以内）また鳴ったら、フェードは続きから。

const WARN_DIST = 3.5; // この距離で危険度 0（接近判定の 3.5m と同じ）
const URGENT_TTC = 3.0; // この TTC で危険度 0（接近判定の TTC 3秒と同じ）

// 調整しやすいように、音の決めごとをここにまとめる。[危険度 0（3.5m）のとき, 危険度 1（0m）のとき]
const LOW_HZ = [1100, 1900]; // 低い方の音の高さ（高い方はこの √2 倍 = 増4度上）
const NOTE_MS = [230, 55]; // 1音の長さ（短いほど交互が速い）
const DUTY = [0.65, 1.0]; // 1音のうち鳴っている割合（1 で隙間なし）
const BRIGHT_HZ = [2500, 9000]; // 音の鋭さ（高い倍音をどこまで残すか）
const VOLUME = [0.18, 0.5];
const ROUGH_FROM = (WARN_DIST - 1.0) / WARN_DIST; // 危険度がこれを超えたら（1m 未満）、ずらした音を重ねる
const FADE_FROM = 0.3; // 鳴り始めの音量（本来の音量に対する割合）
const FADE_S = 1.0; // この秒数で本来の音量になる
const RESUME_S = 1.0; // 止まってからこの秒数以内にまた鳴ったら、フェードを続きからにする

const lerp = ([a, b]: number[], u: number) => a + (b - a) * u;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

// 接近中の人たちから、危険度（0〜1）を出す。一番危ない人に合わせる。誰もいなければ null
export function dangerOf(people: { dist: number; ttc: number | null }[]): number | null {
  if (people.length === 0) return null;
  return Math.max(
    ...people.map((p) => {
      const byDist = (WARN_DIST - p.dist) / WARN_DIST;
      const byTtc = p.ttc === null ? 0 : 1 - p.ttc / URGENT_TTC;
      return clamp01(Math.max(byDist, byTtc));
    }),
  );
}

// 鳴り始めてからの秒数から、音量にかける割合（FADE_FROM〜1）を出す。
// 最初はゆっくり、後半で一気に大きくなる（2乗のカーブ）
export function fadeOf(sinceStart: number): number {
  const x = clamp01(sinceStart / FADE_S);
  return FADE_FROM + (1 - FADE_FROM) * x * x;
}

// また鳴り始めたときの「鳴り始めた時刻」を決める（秒）。
// 止まってすぐなら、止まっていた間だけ後ろにずらして、フェードを止まったところから続ける。
// しばらく止まっていたなら、今から小さく鳴り始める。
export function fadeStartAfter(prevStart: number | null, stoppedAt: number | null, now: number): number {
  if (prevStart === null || stoppedAt === null || now - stoppedAt > RESUME_S) return now;
  return prevStart + (now - stoppedAt);
}

const nowSec = () => performance.now() / 1000;

export class Alarm {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private level: number | null = null; // 危険度。null なら鳴らさない
  private timer: ReturnType<typeof setTimeout> | undefined;
  private high = false; // 次に鳴らすのが高い方か
  private fadeStart: number | null = null; // 鳴り始めた時刻（秒、フェード用）
  private stoppedAt: number | null = null; // 最後に止まった時刻（秒）

  get enabled(): boolean {
    return this.ctx !== null;
  }

  enable(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.master = this.ctx.createGain();
      this.filter.connect(this.master).connect(this.ctx.destination);
    }
    void this.ctx.resume();
    this.siren(0.3, 1); // オンにしたことが分かるように1回鳴らす
  }

  disable(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.ctx?.close();
    this.ctx = null;
    this.filter = null;
    this.master = null;
  }

  // 接近中の人（距離と TTC）を毎フレーム渡す。空なら止める。
  update(approaching: { dist: number; ttc: number | null }[]): void {
    const level = dangerOf(approaching);
    const starting = this.level === null && level !== null;
    const now = nowSec();
    if (this.level !== null && level === null) this.stoppedAt = now;
    // 止まってすぐ（一瞬検出が途切れただけ）なら、始まりの合図もフェードもやり直さない
    const resumed = starting && this.fadeStart !== null && this.stoppedAt !== null && now - this.stoppedAt <= RESUME_S;
    if (starting) this.fadeStart = fadeStartAfter(this.fadeStart, this.stoppedAt, now);
    this.level = level;
    if (!this.ctx || level === null || this.timer !== undefined) return;
    if (starting && !resumed) {
      // 前の大きい音量が残らないように、鳴り始めの小さい音量にすぐ合わせる（まだ何も鳴っていないので、ぷつっとしない）
      const t = this.ctx.currentTime;
      this.master!.gain.cancelScheduledValues(t);
      this.master!.gain.setValueAtTime(lerp(VOLUME, level) * FADE_FROM, t);
      this.siren(level, FADE_FROM);
      this.timer = setTimeout(() => this.loop(), 380);
    } else {
      this.loop();
    }
  }

  private loop(): void {
    if (this.level === null || !this.ctx) {
      this.timer = undefined;
      return;
    }
    const u = this.level;
    const t = this.ctx.currentTime;
    this.setTone(u, fadeOf(nowSec() - (this.fadeStart ?? nowSec())), t);

    const low = lerp(LOW_HZ, u);
    const freq = this.high ? low * Math.SQRT2 : low;
    this.high = !this.high;
    const noteMs = lerp(NOTE_MS, u);
    this.note(freq, t, (noteMs / 1000) * lerp(DUTY, u), u >= ROUGH_FROM);
    this.timer = setTimeout(() => this.loop(), noteMs);
  }

  // 危険度に合わせて、鋭さと音量を変える。fade は鳴り始めのフェード（音量にかける割合）
  private setTone(u: number, fade: number, t: number): void {
    this.filter!.frequency.setTargetAtTime(lerp(BRIGHT_HZ, u), t, 0.05);
    this.master!.gain.setTargetAtTime(lerp(VOLUME, u) * fade, t, 0.05);
  }

  // 警告が始まった合図：サイレンのように下から上へ上がる音。
  // 驚かせないように、小さく始めて上がりながら大きくする
  private siren(u: number, fade: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.setTone(u, fade, t);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(lerp(LOW_HZ, u) * Math.SQRT2, t + 0.32);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.06);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    gain.connect(this.filter!);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  // 1音。のこぎり波（警報らしい、ざらっとした音）。rough なら少しずらした音を重ねてうならせる
  private note(freq: number, start: number, seconds: number, rough: boolean): void {
    const gain = this.envelope(start, seconds);
    const detunes = rough ? [0, 18] : [0];
    for (const d of detunes) {
      const osc = this.ctx!.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq + d;
      const g = this.ctx!.createGain();
      g.gain.value = 1 / detunes.length;
      osc.connect(g).connect(gain);
      osc.start(start);
      osc.stop(start + seconds + 0.02);
    }
  }

  // 音の立ち上がりと消え方（ぷつっと鳴らないように、ごく短くなめらかにする）
  private envelope(start: number, seconds: number): GainNode {
    const gain = this.ctx!.createGain();
    const edge = Math.min(0.008, seconds / 4);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + edge);
    gain.gain.setValueAtTime(1, start + seconds - edge);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    gain.connect(this.filter!);
    return gain;
  }
}
