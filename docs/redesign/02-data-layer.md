# Phase 2: データ層の統一 詳細設計

フロントの表示パスから Athena を外し、ETL 最終段で生成する「集計済み JSON マート」を
表示の唯一のデータソースにする。集計ロジックの散在・表示の遅さ・横断キーの欠如を同時に解消する。

## 現状の問題(再掲)

- 毎ページビューで Athena を 5〜6 クエリ、1 秒間隔ポーリングで直列待ち → 表示に数秒〜十数秒
- `force-dynamic` でキャッシュなし。データは日次/週次更新なのに毎回スキャン課金
- 集計 SQL がフロント 3 ファイルに文字列で散在し、テスト不能・重複だらけ
- 日付形式が fitbit 系 `YYYY-MM-DD` / household_budget `Y/m/d` で混在。
  横断分析の共通キー(日付)が ETL 段階で揃っていない
- データ全体は数 MB。`docs/ai-agent-design.md` が出した「この規模に Athena は過剰、
  DuckDB で直接読めば十分」という結論は表示パスにも当てはまる

## アーキテクチャ

```
現状:  S3 (Parquet/CSV) → Athena ←(SQL 文字列 + ポーリング)─ Next.js Server Actions
変更後: S3 (Parquet/CSV) → mart_builder Lambda (DuckDB) → S3 marts/*.json
                                                             ↑ GetObject(数十 ms)
                                                        Next.js(lib/marts.ts)
        Athena/Glue は残す(アドホック分析・AI エージェント用)。表示パスからのみ撤去
```

## マート設計(S3 レイアウト)

バケットは既存の `fitbit-dashboard` を使い、`marts/` プレフィックス配下に出力する。
すべて UTF-8 JSON、日付キーは ISO `YYYY-MM-DD`(月は `YYYY-MM`)に統一する。

### `marts/meta.json` — 鮮度情報

```json
{
  "generated_at": "2026-07-05T03:30:00+09:00",
  "sources": {
    "fitbit":   {"last_date": "2026-07-04"},
    "budget":   {"last_date": "2026-07-01"},
    "timeline": {"last_date": "2026-06-30"}
  }
}
```

現状 `getDataUpdateStatus` が `fitbit.steps` の MAX(date) だけを「Last updated」として
表示している問題を、ソース別の鮮度表示で置き換える。

### `marts/daily.json` — 日次統合(横断機能の基盤)

日付を主キーに全ソースを 1 行に統合。統合ホーム・デイビュー・相関ビューはすべてこれを読む。

```json
[
  {
    "date": "2026-07-04",
    "steps": 8200,
    "sleep_hours": 6.8, "sleep_start": "23:40", "sleep_end": "06:30",
    "active_zone_min": 32, "low_intensity_min": 45,
    "spending_total": 3400,
    "spending_by_category": {"食費": 2400, "交通費": 1000},
    "visit_count": 3, "out_hours": 5.5,
    "top_places": [{"place_id": "...", "name": "○○ジム", "min": 90}]
  }
]
```

サイズ見積り: 1 行 ≈ 400B × 数年分(〜1500 日)≈ 600KB。1 ファイルで問題ない。
将来肥大化したら年別分割(`daily/2026.json`)に切り替える。

### ページ用マート(既存表示の置き換え)

| ファイル | 内容 | 置き換える既存 action |
|---|---|---|
| `marts/activity_daily.json` | 日次の steps / sleep / active / low_intensity + 30 日移動平均(全期間分。期間フィルタはフロントで) | `getSteps` / `getSleep` / `getActivity` / `getLowIntensity` |
| `marts/activity_monthly.json` | 月次平均(period=All 用) | 同上の `all` 分岐 |
| `marts/budget_monthly.json` | 月 × カテゴリの支出・収入、月合計、取引数 | `getCategoryBreakdown` / `getMonthSummary` / `getMonthComparison` |
| `marts/budget_daily.json` | 日 × カテゴリの支出・収入(累積・トレンドはフロントで導出) | `getDailyCategorySpending` / `getDailySpendingByPeriod` / `getDailyIncomeByPeriod` |
| `marts/timeline_ranking.json` | 月 × 場所の訪問集計(現行 `getTimelineRanking` と同形) | `getTimelineRanking` |
| `marts/timeline_days/{date}.json` | 1 日分の移動履歴(visits + activities 統合) | `getTimelineDayHistory` / `getTimelinePlaceVisits` |

設計方針: **マートは「素の日次/月次粒度」で持ち、期間フィルタ・累積・移動窓の再集計は
フロントで行う**。数百 KB のデータに対しては十分速く、期間切替が即時になる
(現状は期間切替のたびに Athena 再クエリ)。Timeline が既にこの方式で成功している。

## mart_builder Lambda

### 実装

- 配置: `etl/mart_builder/`(lambda_function.py / Dockerfile / requirements.txt)。
  既存 3 本と同じ Docker Lambda パターン
- 依存: `duckdb`, `boto3`(pandas 不要。DuckDB の `read_parquet` / `read_csv` で
  S3 を直接読み、集計結果を JSON 化する)
- 処理:
  1. `s3://fitbit-dashboard/data/**` の Parquet / CSV を DuckDB で読む
  2. 正規化: household_budget の `date`(`Y/m/d`)を ISO に変換、カテゴリ NULL は `不明`、
     金額・数値のキャストをここで一度だけ行う(フロントの `Number(...)` 変換重複を解消)
  3. 上記マートを生成し `marts/` に `put_object`(Content-Type: application/json)
  4. `meta.json` を最後に書く(これが更新完了のマーカー)
- 集計 SQL は現行 action の SQL を移植する。「HOME 除外」等のドメインルール
  (`timeline-actions.ts` の `VISIT_FILTER`)もここに一元化する

### トリガー(EventBridge)

| ルール | cron (UTC) | 意図 |
|---|---|---|
| 日次 | `cron(45 18 * * ? *)` = 3:45 JST | fitbit ETL(3:00 JST)の後 |
| 週次 | `cron(30 19 ? * SUN *)` = 月曜 4:30 JST | gdrive ETL(月曜 4:00 JST)の後 |

シンプルな時刻ずらしで十分(厳密なチェーン実行は不要。失敗時は翌日の実行で回復する)。

### IAM(最小権限)

- `s3:GetObject` — `fitbit-dashboard/data/**`
- `s3:PutObject` — **`fitbit-dashboard/marts/**` のみ**
- CloudWatch Logs

### Terraform

`infrastructure/lambda/mart_builder.tf` を新規作成。`timeline.tf` の構成
(ECR + IAM ロール + Lambda + EventBridge)をコピーして調整する。
メモリ 512MB / タイムアウト 120 秒で開始。

## フロントの読み取り層

### `frontend/src/lib/marts.ts`

```ts
// S3 GetObject で marts/*.json を取得する薄い層。
// 認証情報は既存の環境変数(AWS_ACCESS_KEY_ID 等)を流用し、
// IAM に marts/** の GetObject を追加する。
export async function fetchMart<T>(name: string): Promise<T>
```

- Edge Runtime で `@aws-sdk/client-s3` の `GetObject`(既に athena クライアントで
  同系 SDK を使用しており互換)
- キャッシュ: データ更新は 1 日 1 回なので、Next の `unstable_cache` などで
  TTL 1 時間のキャッシュを付ける。`force-dynamic` は外す
- 型: マートごとに zod ではなく素の TS interface を `lib/mart-types.ts` に定義
  (生成側と手動同期。個人プロジェクトの規模ではスキーマ検証ライブラリは過剰)

### 移行手順(ページ単位で安全に)

1. mart_builder をデプロイし、マートが毎日生成されることを確認(フロント無変更)
2. Timeline → Budget → Activity の順に 1 ページずつ `lib/marts.ts` 読みに切り替え
   (Timeline が最も現行構造に近く、Activity は StatsCard 修正[03]と同時に行う)
3. 全ページ移行後、`app/actions/*.ts` と `lib/athena.ts` をフロントから削除。
   Athena 用 IAM 権限もフロントユーザーから外す(Athena 自体は残す)

### 効果

| 指標 | 現状 | 変更後 |
|---|---|---|
| 初期表示 | Athena 5〜6 クエリ直列ポーリングで数秒〜十数秒 | S3 GetObject 数本(+キャッシュ)で数百 ms |
| 期間切替 | 再クエリで毎回数秒 | フロント再集計で即時 |
| クエリ課金 | ページビューごとにスキャン課金 | ゼロ(日次バッチのみ) |
| 集計ロジック | フロント 3 ファイルに SQL 散在 | mart_builder に一元化 |

## タスクリスト

- [ ] `etl/mart_builder/` 実装(DuckDB 集計 + JSON 出力)
- [ ] `infrastructure/lambda/mart_builder.tf` 追加、apply
- [ ] ECR push + 初回実行でマート生成を確認
- [ ] `frontend/src/lib/marts.ts` / `mart-types.ts` 追加
- [ ] Timeline / Budget / Activity をページ単位で移行
- [ ] `athena-actions.ts` ほかフロントの Athena 依存を削除、IAM 縮小
