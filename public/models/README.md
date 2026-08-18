# 機能⑤ ローカル顔合成モデル

本人写真とCAS職業場面から478点の顔ランドマークをブラウザ内で取得するための固定モデルです。
アプリは起動時にSHA-256を照合し、欠損または意図しない差し替えがある場合は機能⑤を停止します。

| 現在使用するファイル | 取得元 | SHA-256 |
|---|---|---|
| `face_landmarker.task` | Google MediaPipe Face Landmarker `float16/latest` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

取得元：

- <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task>

`selfie_multiclass_256x256.tflite`は、以前の「頭全体を切り抜いて貼る方式」で使っていた旧ファイルです。現在の顔メッシュ方式では読み込まず、起動条件にも含めません。

実行ライブラリは`@mediapipe/tasks-vision@1.0.1`へ固定し、CDNは使用しません。
