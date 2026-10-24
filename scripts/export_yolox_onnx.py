# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#     "torch>=2.2",
#     "torchvision",
#     "opencv-python-headless",
#     "onnx>=1.16",
#     "loguru",
#     "tabulate",
#     "thop",
#     "ninja",
#     "psutil",
#     "numpy",
# ]
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# torchvision = { index = "pytorch-cpu" }
# ///
"""YOLOX-Nano（公式の学習済みの重み）を、好きな入力サイズで ONNX に書き出す。PC で一度だけ使う。

  uv run scripts/export_yolox_onnx.py                       # → pi/models/yolox_nano_256x192.onnx
  uv run scripts/export_yolox_onnx.py --width 320 --height 256

公式の yolox_nano.onnx は入力 416×416 で固定。センサーは 240×180（4:3）なので、
同じ 4:3 で 32 の倍数の 256×192 にすると、計算する画素が約 3.5 分の 1 になり、引き伸ばしで情報も増えない。

PyTorch などはこのスクリプトだけの環境に入る（uv が先頭の dependencies を読む）。pi/ には入らない。
YOLOX のコードと重み（Apache 2.0）は、決まったバージョンをダウンロードして使うだけで、リポジトリには入れない。
書き出し方は YOLOX 公式の tools/export_onnx.py と同じ（SiLU を置き換え、推論時の枠の復元はしない）。
"""

import argparse
import io
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

YOLOX_VERSION = "0.3.0"
SOURCE_URL = f"https://github.com/Megvii-BaseDetection/YOLOX/archive/refs/tags/{YOLOX_VERSION}.tar.gz"
WEIGHTS_URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.pth"
OUT_DIR = Path(__file__).resolve().parents[1] / "pi" / "models"


def download(url: str) -> bytes:
    print(f"ダウンロード: {url}", flush=True)
    with urllib.request.urlopen(url) as res:
        return res.read()


def main() -> None:
    parser = argparse.ArgumentParser(description="YOLOX-Nano を指定の入力サイズで ONNX に書き出す")
    parser.add_argument("--width", type=int, default=256)
    parser.add_argument("--height", type=int, default=192)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    if args.width % 32 or args.height % 32:
        raise SystemExit("幅と高さは 32 の倍数にする（YOLOX の一番粗い stride が 32 のため）")
    out = args.out or OUT_DIR / f"yolox_nano_{args.width}x{args.height}.onnx"

    with tempfile.TemporaryDirectory() as tmp:
        # YOLOX のコードを決まったバージョンで取ってきて、読み込めるようにする
        with tarfile.open(fileobj=io.BytesIO(download(SOURCE_URL))) as tar:
            tar.extractall(tmp, filter="data")
        sys.path.insert(0, str(Path(tmp) / f"YOLOX-{YOLOX_VERSION}"))
        weights = Path(tmp) / "yolox_nano.pth"
        weights.write_bytes(download(WEIGHTS_URL))

        import torch
        from torch import nn
        from yolox.exp import get_exp
        from yolox.models.network_blocks import SiLU
        from yolox.utils import replace_module

        exp = get_exp(None, "yolox-nano")
        model = exp.get_model()
        model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=False)["model"])
        model.eval()
        model = replace_module(model, nn.SiLU, SiLU)
        model.head.decode_in_inference = False  # 枠の復元は pi/detect.py でやる（公式の ONNX と同じ出力にする）

        dummy = torch.zeros(1, 3, args.height, args.width)
        out.parent.mkdir(parents=True, exist_ok=True)
        torch.onnx.export(model, dummy, str(out), input_names=["images"], output_names=["output"],
                          opset_version=11, dynamo=False)

    import onnx

    m = onnx.load(str(out))
    onnx.checker.check_model(m)
    shape = [d.dim_value for d in m.graph.output[0].type.tensor_type.shape.dim]
    print(f"書き出しました: {out}（入力 {args.width}×{args.height}、出力 {shape}）")


if __name__ == "__main__":
    main()
