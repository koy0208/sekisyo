# face_align Lambda

`data/photos/` の顔写真を顔検出 → 両目基準の相似変換で整列し、
`data/photos_aligned/` に 512×512 JPEG を出力する。
全写真で目の位置が揃うため、フロントエンドの顔タイムラプス
(`/face`) がブレなく再生できる。

## 起動モード

1. **S3 PutObject トリガー** (通常運用): gdrive_to_s3 が写真を転送するたび、
   その写真だけを自動処理
2. **backfill 手動 invoke** (初回・整列パラメータ変更時):

   ```bash
   AWS_PROFILE=kapp-dev-user aws lambda invoke \
     --function-name face-align-lambda \
     --payload '{"mode": "backfill"}' \
     --cli-binary-format raw-in-base64-out /dev/stdout
   ```

   出力側に存在しないファイルのみ処理する(冪等)。
   パラメータ変更後の全件再処理は `data/photos_aligned/` を削除してから実行。

## 処理内容

1. EXIF Orientation を適用 (スマホ写真の回転対策)
2. mediapipe Tasks API (FaceDetector + 同梱の BlazeFace short-range モデル) で
   顔検出 (最大の顔を採用)
3. 両目キーポイントを固定座標 (x=35%/65%, y=40%) へ移す相似変換で 512×512 に切り出し
4. 検出失敗時は中央スクエアクロップにフォールバックし、
   S3 メタデータ `aligned: false` を付与
5. 最後に `marts/face_photos.json` (一覧インデックス) を再生成。
   フロントエンドの表示パスはこのマートだけを読む (S3 List を使わない)

## デプロイ

```bash
docker build --platform linux/arm64 -t face-align-lambda .
# ECR ログイン → tag → push → aws lambda update-function-code
```
