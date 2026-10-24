// 2D 深度ビュー＋人の表示（仕様書 6章、M7・M8）。
// 25fps で描くので、React の再描画ではなく Canvas に直接描く。
// 深度は 240×180 の小さな Canvas に描いてから拡大し、枠や文字は拡大後の大きさで描く（文字をぼかさないため）。

import { useEffect, useRef } from "react";
import { DANGER, DEPTH_LUT, SAFE } from "../colors";
import { H, W, u8ToMeters, type FrameMessage, type Person } from "../protocol";

const PERSON_WINDOW = 0.4; // 人の部分とみなす距離の幅 [m]（仕様書 5章の距離計算と同じ）

export function DepthView({ frame }: { frame: FrameMessage | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const small = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 表示の大きさに合わせて Canvas の画素数を変える（高解像度の画面でもくっきり）
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !frame) return;
    small.current ??= Object.assign(document.createElement("canvas"), { width: W, height: H });
    drawDepth(small.current, frame);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small.current, 0, 0, canvas.width, canvas.height);
    const scale = canvas.width / W;
    for (const p of frame.people) drawPerson(ctx, p, scale);
  }, [frame]);

  return <canvas ref={canvasRef} className="depth-canvas" />;
}

function drawDepth(canvas: HTMLCanvasElement, frame: FrameMessage) {
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(W, H);
  const px = image.data;
  const { depth } = frame;
  for (let i = 0; i < depth.length; i++) {
    const c = depth[i] * 4;
    px[i * 4] = DEPTH_LUT[c];
    px[i * 4 + 1] = DEPTH_LUT[c + 1];
    px[i * 4 + 2] = DEPTH_LUT[c + 2];
    px[i * 4 + 3] = 255;
  }
  // 人の部分（枠の中で、その人の距離に近い画素）を明るく。接近中は赤く
  for (const p of frame.people) {
    const [bx, by, bw, bh] = p.box;
    const tint = p.approaching ? [255, 59, 78] : [255, 255, 255];
    const mix = p.approaching ? 0.65 : 0.4;
    for (let y = Math.max(0, by); y < Math.min(H, by + bh); y++) {
      for (let x = Math.max(0, bx); x < Math.min(W, bx + bw); x++) {
        const i = y * W + x;
        const z = u8ToMeters(depth[i]);
        if (z === null || Math.abs(z - p.dist) > PERSON_WINDOW) continue;
        for (let k = 0; k < 3; k++) px[i * 4 + k] = px[i * 4 + k] * (1 - mix) + tint[k] * mix;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

function drawPerson(ctx: CanvasRenderingContext2D, p: Person, scale: number) {
  const [bx, by, bw, bh] = p.box.map((v) => v * scale);
  const color = p.approaching ? DANGER : SAFE;
  const s = scale / 2.5; // 線や文字の太さを、表示の大きさに合わせる

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * s;
  ctx.lineCap = "round";
  if (p.approaching) {
    ctx.shadowColor = DANGER;
    ctx.shadowBlur = 16 * s;
  }

  // 枠の四隅
  const c = Math.min(bw, bh) * 0.22;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [
    [bx, by, 1, 1],
    [bx + bw, by, -1, 1],
    [bx, by + bh, 1, -1],
    [bx + bw, by + bh, -1, -1],
  ]) {
    ctx.moveTo(x + dx * c, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * c);
  }
  ctx.stroke();
  ctx.restore();

  // ラベル（ID・距離／速度・TTC）
  const line1 = `ID ${p.id}  ${p.dist.toFixed(2)} m`;
  const line2 = `${p.speed >= 0 ? "+" : ""}${p.speed.toFixed(2)} m/s  ·  TTC ${p.ttc === null ? "—" : `${p.ttc.toFixed(1)} s`}`;
  const font = Math.max(11, 13 * s);
  ctx.font = `600 ${font}px ui-sans-serif, system-ui, sans-serif`;
  const pad = 6 * s;
  const w = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + pad * 2;
  const h = font * 2.4 + pad;
  const x = Math.min(Math.max(0, bx + bw / 2 - w / 2), ctx.canvas.width - w);
  // 枠の上に入らないとき（近くて枠が大きいとき）は、枠の内側の上端に置く
  const above = by - h - 6 * s;
  const y = Math.min(above > 0 ? above : Math.max(0, by) + 6 * s, ctx.canvas.height - h);
  ctx.fillStyle = p.approaching ? "rgba(255, 59, 78, 0.92)" : "rgba(8, 12, 32, 0.78)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6 * s);
  ctx.fill();
  ctx.fillStyle = p.approaching ? "#fff" : SAFE;
  ctx.textBaseline = "top";
  ctx.fillText(line1, x + pad, y + pad);
  ctx.font = `500 ${font * 0.85}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(line2, x + pad, y + pad + font * 1.25);
}
