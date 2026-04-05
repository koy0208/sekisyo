｀# Google Drive → S3 転送 Lambda

Google Drive上の指定フォルダ内のファイルを S3 に転送するLambda関数。
フォルダ内に同名ファイルがある場合は更新日が最新のもののみ転送する。
毎週月曜 JST 04:00 にEventBridgeから自動実行される。

## 構成

```
etl/gdrive_to_s3/
├── lambda_function.py   # 転送ロジック
├── Dockerfile           # Lambda Dockerイメージ
├── requirements.txt     # Python依存関係
└── README.md

infrastructure/lambda/
└── gdrive.tf            # Terraform（Lambda, ECR, IAM, EventBridge）
```

## セットアップ手順
### 1. GCP側の設定

1. [GCPコンソール](https://console.cloud.google.com/) で **Google Drive API** を有効化
2. **サービスアカウントを作成**（IAMと管理 → サービスアカウント → 作成）
3. JSON鍵をダウンロード
4. Google Driveで転送対象のファイルをサービスアカウントのメールアドレス（`xxx@xxx.iam.gserviceaccount.com`）に **閲覧者** として共有

### 2. AWS Secrets Manager にシークレットを登録

```bash
aws secretsmanager create-secret \
  --name "prod/dashboard/gdrive" \
  --secret-string '{
    "SERVICE_ACCOUNT_KEY": <ダウンロードしたJSON鍵の内容>
  }'
```

> JSON鍵の内容をそのままオブジェクトとして埋め込む。文字列として格納する場合はエスケープが必要。

### 3. 転送対象フォルダIDの指定

Google DriveのURLからフォルダIDを取得する。

```
https://drive.google.com/drive/folders/<FOLDER_ID>
```

`infrastructure/lambda/gdrive.tf` の環境変数 `GDRIVE_FOLDER_IDS` に `folder_id:s3_prefix` 形式でカンマ区切りで設定する。
s3_prefix を省略した場合は `data/gdrive/` がデフォルトで使用される。

```hcl
environment {
  variables = {
    GDRIVE_FOLDER_IDS = "1abc123def:data/household_budget/,2ghi456jkl:data/other/"
  }
}
```

### 4. デプロイ

```bash
# ECRリポジトリ作成（初回のみ）
cd infrastructure/lambda
terraform apply

# Dockerイメージをビルド＆プッシュ
cd ../../etl/gdrive_to_s3
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com
docker build -t gdrive-to-s3-lambda .
docker tag gdrive-to-s3-lambda:latest <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/gdrive-to-s3-lambda:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/gdrive-to-s3-lambda:latest

# Lambda関数を更新
aws lambda update-function-code \
  --function-name gdrive-to-s3-lambda \
  --image-uri <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/gdrive-to-s3-lambda:latest
```

## ファイル形式の変換

| Google Drive上の形式 | S3保存形式 |
|---|---|
| Google Spreadsheet | CSV |
| Google Document | テキスト |
| CSV, Excel等 | そのまま |

## スケジュール

- **頻度**: 週次（毎週月曜）
- **時刻**: JST 04:00（UTC 日曜 19:00）
- **EventBridge cron**: `cron(0 19 ? * SUN *)`

## 手動実行

```bash
aws lambda invoke \
  --function-name gdrive-to-s3-lambda \
  --payload '{}' \
  output.json
```
