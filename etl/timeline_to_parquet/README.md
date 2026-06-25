# Google Maps タイムライン → Parquet 変換 Lambda

Google Drive から S3 に同期された Google Maps タイムライン JSON を、Athena 集計用の
Parquet（`visits` / `activities`）に変換する Lambda 関数。

## 処理の流れ

```
gdrive-to-s3 Lambda (週次)
  └─ タイムライン.json を生コピー → s3://fitbit-dashboard/data/gdrive/timeline/*.json
        │  S3 PutObject イベントで起動
        ▼
timeline-to-parquet Lambda
  1. data/gdrive/timeline/ 配下の *.json を全件読込
  2. semanticSegments を visits / activities に展開（timelinePath はスコープ外）
  3. 重複排除（複数ファイル・期間重複に対応）
       - visits     : (start_time, end_time, hierarchy_level) で一意化
       - activities : (start_time, end_time, activity_type)   で一意化
       - 同一キーは probability が高い行を採用
  4. placeId 解決（place_cache.parquet 参照 → 未知のみ Places API → 追記保存）
  5. Parquet を上書き出力
       → data/timeline/visits/visits.parquet
       → data/timeline/activities/activities.parquet
       → data/timeline/place_cache/place_cache.parquet
```

JSON はフル履歴のエクスポートのため、毎回全件を読み直して出力を作り直す（冪等）。

## テーブル

### visits（滞在）
`start_time, end_time, duration_min, date, hierarchy_level, place_id, semantic_type,
lat, lng, probability, place_name, place_address`

- `hierarchy_level`: 0=広いエリア/建物, 1=その中の具体的な場所（入れ子）。
  滞在時間の二重計上を避ける集計では `WHERE hierarchy_level = 0` で絞る。
- `place_name` / `place_address`: place_cache（Places API 解決結果）から付与。

### activities（移動）
`start_time, end_time, duration_min, date, activity_type, distance_m,
start_lat, start_lng, end_lat, end_lng, probability`

- `activity_type`: WALKING / IN_PASSENGER_VEHICLE / CYCLING / IN_TRAIN / IN_SUBWAY / IN_BUS 等

## placeId 解決（Places API）

- Places API (New) の Place Details を使用。キーは Secrets Manager
  `prod/dashboard/gdrive` の `GOOGLE_MAPS_API_KEY` に格納する。
- `place_cache.parquet` に解決済み placeId を蓄積し、未解決のみ API 呼び出し（placeId は不変なので使い回し可）。
- 初回は全 placeId（実データで約2,300件）を解決するため一回限りのコストが発生。以降はキャッシュで無料。
- キー未設定の場合は名前解決をスキップし、visits/activities のみ生成する。

### Places API キーの準備（手動）

```bash
# GCP で「Places API (New)」を有効化し、APIキーを発行後:
# 既存シークレットに GOOGLE_MAPS_API_KEY を追加（既存値を保持してマージ）
aws secretsmanager get-secret-value --secret-id prod/dashboard/gdrive \
  --query SecretString --output text > /tmp/gdrive_secret.json
# /tmp/gdrive_secret.json に "GOOGLE_MAPS_API_KEY": "..." を追加して:
aws secretsmanager put-secret-value --secret-id prod/dashboard/gdrive \
  --secret-string file:///tmp/gdrive_secret.json
```

## デプロイ

Lambda は arm64(Graviton)。Mac(Apple Silicon)でネイティブビルドする。
ECR はリポジトリ作成 → イメージ push → 関数作成 の順に依存するため、初回は ECR を
先に作る。

```bash
ACCOUNT_ID=060795942826
REGION=ap-northeast-1
REPO=${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/timeline-to-parquet-lambda

# 1. ECR リポジトリのみ先に作成（イメージが無いと関数作成が失敗するため）
cd infrastructure/lambda
AWS_PROFILE=kapp-dev-user terraform apply -target=aws_ecr_repository.timeline_lambda_repo

# 2. arm64 でビルドし push
#    Lambda は OCI マニフェストを受け付けないため、buildx で
#    oci-mediatypes=false（Docker schema2）を強制して push する。
cd ../../etl/timeline_to_parquet
AWS_PROFILE=kapp-dev-user aws ecr get-login-password --region ${REGION} | \
  docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com
docker buildx build --platform linux/arm64 --provenance=false \
  --output type=image,name=${REPO}:latest,oci-mediatypes=false,push=true .

# 3. 残りのインフラ（Lambda 本体・S3トリガー）を作成
cd ../../infrastructure/lambda && AWS_PROFILE=kapp-dev-user terraform apply

# 4. Athena テーブル作成
cd ../athena && AWS_PROFILE=kapp-dev-user terraform apply
```

> 既存関数のコード更新のみなら、上記 2 で push 後に
> `aws lambda update-function-code --function-name timeline-to-parquet-lambda --image-uri ${REPO}:latest`

## 手動実行

```bash
AWS_PROFILE=kapp-dev-user aws lambda invoke \
  --function-name timeline-to-parquet-lambda --payload '{}' output.json
```
