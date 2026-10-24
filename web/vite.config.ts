import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 開発中に本物の Pi につなぐときは、/ws を Pi に転送する
//   PI_HOST=192.168.x.x pnpm dev
// PI_HOST がなければ転送せず、デモデータで動く
const piHost = process.env.PI_HOST;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: piHost ? { "/ws": { target: `ws://${piHost}:8000`, ws: true } } : undefined,
  },
});
