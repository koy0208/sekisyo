# 簡易バックエンド設計(Lambda API + DB)

書き込み系機能(手入力・タグ付け・外部からの取り込み等)のための簡易バックエンドの設計。
方針検討時点(2026-07)の結論をまとめる。[redesign/04-cross-features.md](./redesign/04-cross-features.md)
の Phase 4 各機能(目標・場所タグ・AI インサイト)と関連するが、独立に着手できる。

## 前提と設計原則

- 個人利用・単一ユーザー。同時実行や高トラフィックは考慮しない
- DB は**恒久無料枠に収まること**を必須条件とする
- フロント(Next.js Server Actions)は既に IAM ユーザーの認証情報で AWS に直接アクセスしている
  (`frontend/src/lib/marts.ts` の S3Client)。この信頼モデルの延長で設計する
- ETL 側(mart_builder / 将来の insight_agent)からも同じ DB に書けること

## 全体像

```
[Next.js Server Actions] ──直接── DynamoDB (sekisyo-app)   ← フロント発の読み書き
[スマホ/外部クライアント] ── Lambda Function URL ──┤        ← 外部からの取り込みだけ
[ETL Lambda]             ──直接──┘ (DynamoDB / S3)          ← バッチからの書き込み
```

原則: **フロント発の操作に Lambda API を挟まない**。Lambda が必要になるのは
「外部クライアントが直接叩く受け口」だけ。

## DB 選定: DynamoDB

| 候補 | 無料枠 | 評価 |
|---|---|---|
| **DynamoDB(採用)** | 25GB + 25 RCU/WCU 恒久無料 | ETL・IAM・Terraform が全部 AWS に揃っている現構成と整合。条件付き書き込み・部分更新が可能 |
| Cloudflare D1 | 5GB 恒久無料 | フロントが Pages なので binding で直結できるが、AWS Lambda から書くには HTTP API 経由になり、データ面が 2 クラウドに割れる |
| S3 JSON(現行パターン拡張) | 実質無料 | 追加インフラゼロだが、同時書き込み・部分更新・クエリ不可。「レコードが増えていく」データには不向き |

- 課金モードは**プロビジョンド最小構成**(オンデマンドは無料枠対象外)。
  25 RCU/WCU の恒久無料枠内なら完全に ¥0
- 設定値のような低頻度・少量データだけなら S3 JSON でも足りる
  (04-cross-features の `marts/config.json` 案)。日次メモや手入力ログのような
  蓄積型データを想定するため DynamoDB を採用する

## テーブル設計

汎用の PK/SK 1 テーブル(`sekisyo-app`)で開始する。個人利用のデータ量なので
single-table 設計を深く考える必要はなく、「エンティティ種別#キー」で十分。

| エンティティ | PK | SK | 備考 |
|---|---|---|---|
| 日次メモ | `NOTE#2026-07-05` | `v0` | デイビュー(4a)から読み書き |
| 目標 | `GOAL` | `steps_per_day` | 当面は `goals.ts`(静的ファイル)のままで可。UI が欲しくなったら移行 |
| 場所タグ | `PLACETAG` | `<place_id>` | 4d の `place-tags.ts` の DB 版 |
| AI インサイト既読等 | `INSIGHT#2026-07-05` | `meta` | 本文は S3 `insights/`、状態だけ DB |

- クエリパターンが増えたら GSI を足す。最初は作らない

## API 層の方針

### フロント発の読み書き: Server Actions から直接

- `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` を追加し、
  `lib/marts.ts` と同様のクライアント初期化パターンで直接読み書きする
- Lambda + API Gateway を挟まない理由: コード置き場・デプロイ経路・型同期が
  1 段増えるだけで、単一ユーザー構成では得るものがない
- 既存 IAM ユーザーに、このテーブル限定の
  `dynamodb:GetItem / PutItem / UpdateItem / DeleteItem / Query` を追加する(最小権限)

### 外部クライアントの受け口: Lambda Function URL

外部クライアント(例: スマホのショートカットから Timeline JSON をアップロード)が
必要になった場合のみ追加する。

- **API Gateway は使わない**: 無料枠が 12 ヶ月で切れる。
  Lambda Function URL は恒久無料(Lambda 実行課金のみ、無料枠 100 万リクエスト/月)
- 認証: `AuthType: NONE` + 自前トークンヘッダ検証(トークンは Secrets Manager)。
  未認証リクエストは即 401。IAM 認証(`AWS_IAM`)はスマホのショートカットから
  SigV4 署名が困難なため採用しない
- 実装は既存 ETL と同じ Python + Docker Lambda パターン(`etl/` 配下)

## IaC / 型同期

- Terraform: `infrastructure/lambda` に `aws_dynamodb_table` を追加
  (Function URL が必要になったら `aws_lambda_function_url` も同モジュールに)
- 型定義: `mart-types.ts` と同様、フロント側 `frontend/src/lib/app-db-types.ts`(仮)に
  手動同期で定義する

## セキュリティ上の注意

- Server Actions からの直接アクセスは「認証情報が Cloudflare 側の環境変数にある」
  という既存の信頼モデルの延長。IAM ポリシーはテーブル・アクション単位で最小にする
- Function URL を公開する場合、認証トークンの検証をハンドラ先頭で必ず行う。
  ダッシュボード本体は Cloudflare Access で保護されているが、Function URL は
  その外側にある別の入口であることに注意

## 未確定事項

バックエンドに載せるユースケースは未確定。候補:

1. 日次メモ・タグ付けなどの手入力(ダッシュボード上から書き込み)
2. スマホ等の外部クライアントからのデータ受け口(Timeline JSON アップロードなど)
3. AI インサイトの保存・既読管理

1 だけなら Lambda API(Function URL)は不要で、DynamoDB + Server Actions で完結する。
2 が必要になった時点で Function URL を追加する。
