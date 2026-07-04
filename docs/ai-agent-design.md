# AI エージェント機能 設計案

Fitbit・家計簿・位置情報データに対する Python ベースの AI エージェント機能の設計案。
現状実装のレビュー結果と、段階的な実装プラン(案 1 → 案 2)をまとめる。

## 背景: 現状アーキテクチャの整理

```
Fitbit API / Google Drive → Python Docker Lambda (ETL) → S3 (Parquet/CSV)
                                                          → Athena (Glue: fitbit / sekisyo)
                                                          → Next.js Server Actions → Recharts
```

| 項目 | 現状 |
|---|---|
| データ | S3 `fitbit-dashboard`。`fitbit` DB(sleep / steps / activity / low_intensity)、`sekisyo` DB(household_budget, visits, activities)。全体で数万行・数 MB と小規模 |
| フロント | Next.js 15 / Cloudflare Pages(`@cloudflare/next-on-pages` = Edge Runtime)。Server Actions が静的 IAM キーで Athena を直接実行 |
| Python 基盤 | Docker Lambda × 3(ECR / Terraform / EventBridge / Secrets Manager)。確立済みのデプロイパターンあり |
| LLM 利用 | なし |

### エージェント設計に効く制約

1. **Cloudflare Pages では Python が動かない**
   対話型にする場合、フロントとは別の Python バックエンド(Lambda)が必要。
2. **ダッシュボードに認証がない**
   Server Actions は実質公開 POST エンドポイント。「任意 SQL を実行できるエージェント API」を
   認証なしで公開することはできない。読み取り専用 IAM + 認証が前提。
3. **機微データを扱う**
   健康・位置・家計データを Claude API に送信する(API 経由のデータは学習利用されないが、
   この前提を明示しておく)。

## 変更する前提

### 前提変更 1: エージェントのクエリエンジンは Athena ではなく DuckDB

データ全体が数 MB のため、エージェントのツール実行では Lambda 内で **DuckDB が S3 の
Parquet を直接読む**。

- Athena はクエリごとに数秒のレイテンシ + スキャン課金があり、エージェントの
  試行錯誤ループ(1 回の応答で 5〜10 クエリ)に不向き
- DuckDB なら Lambda 内で完結し、ミリ秒オーダー・追加コストゼロ
- ダッシュボード(既存 Server Actions)は Athena のまま。併用とする

### 前提変更 2: フレームワークは使わない

LangChain 等のエージェントフレームワークや Managed Agents は採用しない。
データがプライベート S3 にありツールは自前実装になるため、素の Anthropic SDK の
ツールユースループ(50 行程度)で十分。依存を最小に保つ。

## 案 1: 週次インサイトレポート・エージェント(バッチ型)— 最初に実装

### 概要

既存 ETL と同一パターンの Python Docker Lambda を 1 本追加。EventBridge で週次起動し、
Claude がツールユースで自律的にデータを探索して「今週のサマリと気づき」を生成、
S3 に保存する。ダッシュボードは保存済みレポートを読んで表示するだけ。

```
EventBridge (毎週月曜 5:00 JST)
  → Lambda: etl/insight_agent/  (Docker, Python 3.11)
      ├─ DuckDB で s3://fitbit-dashboard/data/**.parquet を直接クエリ
      ├─ Anthropic API (claude-opus-4-8, adaptive thinking) ツールユースループ
      └─ 結果を s3://fitbit-dashboard/data/insights/YYYY-MM-DD.json に保存
  → ダッシュボード: 「AI インサイト」カードが最新レポートを表示
```

### エージェントのツール定義

| ツール | 説明 |
|---|---|
| `get_schema` | 利用可能なテーブル・カラム・データ期間の一覧を返す(静的カタログ) |
| `run_sql` | DuckDB で SELECT を実行(読み取り専用。SELECT 以外は拒否、結果行数上限あり) |

### 出力フォーマット(S3 保存)

```json
{
  "generated_at": "2026-07-06T05:00:00+09:00",
  "period": {"from": "2026-06-29", "to": "2026-07-05"},
  "summary_md": "## 今週のハイライト\n- ...",
  "metrics": {"sleep_avg_hour": 6.8, "steps_avg": 8200, "spending_total": 45300},
  "model": "claude-opus-4-8",
  "usage": {"input_tokens": 0, "output_tokens": 0}
}
```

### 追加リソース(Terraform)

- Lambda 関数 + ECR リポジトリ(既存 `infrastructure/lambda/` に追加)
- EventBridge ルール(週次)
- IAM ロール: `s3:GetObject`(data/**)+ `s3:PutObject`(data/insights/** のみ)+
  Secrets Manager 読み取り。**書き込みは insights 配下に限定**
- Secrets Manager: `prod/dashboard/anthropic`(`ANTHROPIC_API_KEY`)

### コスト・リスク

- 週 1 回・入出力合わせて数万トークン程度 → 月数十〜百円オーダー
- 認証・ストリーミング・暴走の懸念なし(バッチ・回数固定)
- max_tokens / ツール呼び出し回数に上限を設定して上振れを防止

## 案 2: 自然言語 Q&A チャット(対話型)— 案 1 の拡張

### 概要

「先月ジムに何回行った?睡眠との相関は?」に答えるチャット UI。
案 1 のツール実装・Docker イメージを流用する。

```
Next.js (チャット UI)
  → fetch (SSE)
  → Lambda Function URL + Lambda Web Adapter (FastAPI, response streaming)
      └─ 案 1 と同じツールユースループ(ストリーミング応答)
```

### 案 1 との差分

| 項目 | 内容 |
|---|---|
| 実行形態 | FastAPI + [Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter) で SSE ストリーミング |
| 認証 | **必須**。Cloudflare Access(ダッシュボードごと保護)を第一候補とする |
| コスト制御 | 会話ターン数上限・レート制限・月次予算アラート(CloudWatch) |
| フロント | チャットコンポーネント追加。Edge Runtime から Function URL へ fetch |

認証方式の確定が実装の前提となるため、案 1 の運用が安定してから着手する。

## 実装ステップ

1. **PoC**: ローカルで DuckDB + Anthropic SDK のツールループを動かし、
   レポート品質とトークン消費を確認
2. **案 1 実装**: `etl/insight_agent/`(lambda_function.py / Dockerfile / requirements.txt)
   + Terraform + Secrets 登録
3. **ダッシュボード表示**: インサイトカード追加(S3 の JSON を読むだけ)
4. **評価後、案 2 検討**: 認証(Cloudflare Access)導入 → チャット API + UI

## 採用しなかった選択肢

| 選択肢 | 不採用の理由 |
|---|---|
| Athena をエージェントのツールにする | レイテンシ・スキャン課金がループに不向き。データが小さく DuckDB で十分 |
| Managed Agents | ツールが全て自前(プライベート S3)であり、ホスト型ループの利点が薄い |
| LangChain 等のフレームワーク | ツール 2 個のループに対して依存が過大 |
| Next.js 内(TypeScript)でエージェント実装 | Python 指定の要件に反する。Edge Runtime のストリーミング・実行時間制約もある |
