"""スレッドA（25fps）：取得 → 枠の追従 → 距離 → 追跡 → TTC → 送信。

スレッドB（detect.py）は、最新の振幅画像に検出をかけて、BBOX を A に渡す。

  uv run main.py          # 実機
  uv run main.py --fake   # センサーなし（fake_sensor）
"""


def main() -> None:
    # TODO: 引数の処理、Sensor / FakeSensor、Detector のスレッド、Tracker、Server をつなぐ
    raise NotImplementedError


if __name__ == "__main__":
    main()
