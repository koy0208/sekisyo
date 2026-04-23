# Sekisyo - Personal Health Data Dashboard

Fitbit/Google Drive のデータを AWS Lambda で ETL し、S3 (Parquet) に保存、Athena で集計して Next.js ダッシュボードで可視化するプロジェクト。

## Project Structure

```
sekisyo/
├── frontend/          # Next.js 15 ダッシュボード (TypeScript, Cloudflare Pages)
├── etl/               # Python Lambda ETL
│   ├── fitbit_to_s3/  # Fitbit API → S3 (毎日 3:00 JST)
│   └── gdrive_to_s3/  # Google Drive → S3 (毎週月曜 4:00 JST)
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
npm run deploy     # Cloudflare Pages にデプロイ
npm run lint       # ESLint
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
- **ETL**: Python 3.11, pandas, PyArrow, Docker (AWS Lambda)
- **Data**: S3 (Parquet), Amazon Athena, Glue Catalog
- **IaC**: Terraform
- **Region**: ap-northeast-1

## Data Flow

Fitbit API / Google Drive → Lambda ETL → S3 (Parquet) → Athena → Next.js Server Actions → Recharts

## Key Files

- `frontend/src/app/page.tsx` - メインダッシュボード
- `frontend/src/app/actions/athena-actions.ts` - Athena クエリ (Server Actions)
- `frontend/src/lib/athena.ts` - Athena クライアント
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
