# Sekisyo - Personal Health Data Dashboard

Fitbit/Google Drive のデータを AWS Lambda で ETL し、S3 (Parquet) に保存、mart_builder Lambda (DuckDB) で集計済み JSON マートを生成して Next.js ダッシュボードで可視化するプロジェクト。Athena/Glue はアドホック分析用に残す(表示パスでは使わない)。

## Project Structure

```
sekisyo/
├── frontend/          # Next.js 15 ダッシュボード (TypeScript, Cloudflare Pages)
├── etl/               # Python Lambda ETL
│   ├── fitbit_to_s3/        # Fitbit API → S3 (毎日 3:00 JST)
│   ├── gdrive_to_s3/        # Google Drive → S3 (毎週月曜 4:00 JST)
│   ├── timeline_to_parquet/ # タイムライン JSON → Parquet (S3 Put で起動)
│   └── mart_builder/        # S3 生データ → marts/*.json (毎日 3:45 / 月曜 4:30 JST)
├── infrastructure/    # Terraform (AWS)
│   ├── athena/        # Athena workgroup, Glue catalog, IAM user
│   └── lambda/        # Lambda, ECR, EventBridge
└── package.json       # ルートの npm scripts (frontend へ委譲)
```

## Commands

### Frontend

```bash
npm run dev        # Next.js dev server (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
# デプロイは master への push で Cloudflare Pages の CD が自動実行される
# (npm run deploy は手動用。CLOUDFLARE_API_TOKEN が必要でローカルでは通常使わない)
```

### ETL (Docker Lambda)

```bash
cd etl/fitbit_to_s3   # or etl/gdrive_to_s3
docker build -t <image-name> .
# ECR push → aws lambda update-function-code
```

### Infrastructure

```bash
cd infrastructure/athena   # or infrastructure/lambda
terraform init && terraform plan && terraform apply
```

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS v4, Shadcn UI, Recharts
- **Deployment**: Cloudflare Pages (wrangler)
- **ETL**: Python 3.11, pandas, PyArrow, DuckDB (mart_builder), Docker (AWS Lambda)
- **Data**: S3 (Parquet + JSON マート), Amazon Athena / Glue Catalog (アドホック分析用)
- **IaC**: Terraform
- **Region**: ap-northeast-1

## Data Flow

Fitbit API / Google Drive → Lambda ETL → S3 data/ (Parquet/CSV) → mart_builder Lambda (DuckDB) → S3 marts/*.json → Next.js (lib/marts.ts) → Recharts

## Key Files

- `frontend/src/app/page.tsx` - メインダッシュボード
- `frontend/src/lib/marts.ts` - マート読み取り層 (S3 GetObject + キャッシュ)
- `frontend/src/lib/mart-types.ts` - マートの型定義 (mart_builder と手動同期)
- `etl/mart_builder/lambda_function.py` - マートビルダー (集計 SQL の一元管理)
- `etl/fitbit_to_s3/lambda_function.py` - Fitbit ETL
- `etl/gdrive_to_s3/lambda_function.py` - Google Drive ETL

## Communication

- 確認や選択を求める際は番号付きリストで提示し、ユーザーの自由入力を最小限にする
- 応答はすべて日本語で行うこと
- 指示が曖昧な場合は、必要に応じて質問して明確化すること
- 指示を盲目的に実行せず、設計判断やリスクを評価し、問題があれば代替案とともに指摘すること

## Conventions

- コミットメッセージは Conventional Commits (`feat:`, `fix:`, `style:` 等)
- フロントエンドのパスエイリアス: `@/*` → `frontend/src/*`
- 環境変数は `frontend/.env.local` (git 管理外)
- AWS CLI 実行時は `AWS_PROFILE=kapp-dev-user` を指定する
