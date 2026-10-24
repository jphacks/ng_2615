#!/usr/bin/env bash
# PC から Pi へ、Git に入っていないもの（ビルドした画面・検出モデル）を送る。
#
#   scripts/deploy_pi.sh <ユーザー>@<PiのIP>                 # 例：scripts/deploy_pi.sh pi@192.168.0.10
#   scripts/deploy_pi.sh <ユーザー>@<PiのIP> --recordings    # 録画（pi/recordings/*.npz）も送る
#
# Pi 側のリポジトリは ~/ng_2615 にある前提（違うときは PI_DIR=... を付ける）。
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "使い方: scripts/deploy_pi.sh <ユーザー>@<PiのIP> [--recordings]" >&2
  exit 1
fi
TARGET=$1
PI_DIR=${PI_DIR:-ng_2615}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODEL=$ROOT/pi/models/yolox_nano_256x192.onnx

# 1. 画面をビルド（Pi には Node を入れない）
(cd "$ROOT/web" && pnpm install --frozen-lockfile && pnpm build)

# 2. 検出モデルがなければ作る（PyTorch はこのスクリプト専用の環境に入る）
if [[ ! -f $MODEL ]]; then
  (cd "$ROOT" && uv run scripts/export_yolox_onnx.py)
fi

# 3. 送る
ssh "$TARGET" "mkdir -p $PI_DIR/web/dist $PI_DIR/pi/models $PI_DIR/pi/recordings"
scp -r "$ROOT/web/dist/." "$TARGET:$PI_DIR/web/dist/"
scp "$MODEL" "$TARGET:$PI_DIR/pi/models/"
if [[ ${2:-} == "--recordings" ]]; then
  scp "$ROOT"/pi/recordings/*.npz "$TARGET:$PI_DIR/pi/recordings/"  # 顔が写るので、Pi 以外には送らない
fi
echo "送りました → $TARGET:$PI_DIR"
