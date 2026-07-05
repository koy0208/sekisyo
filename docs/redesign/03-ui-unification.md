# Phase 3: UI の統一 詳細設計

期間セレクタ・言語・エラー表示・カードのセマンティクスを統一し、
「3 つの別アプリ」に見える状態を解消する。統合ホームで日付軸の横断ビューを作る。

## 3a. 期間モデルと PeriodSelector の共通化

### 現状

| ページ | 実装 | ラベル | センチネル |
|---|---|---|---|
| Activity | `PERIOD_OPTIONS` + searchParams Link | `1 Month` 等 | `unit: 'all'` |
| Budget | 別実装の `PERIOD_OPTIONS` + 月ピッカー | `1M` 等 | `amount: undefined` |
| Timeline | クライアント側の粒度切替(月/四半期/年) | — | — |

### 設計

- 新規 `frontend/src/lib/period.ts`:

```ts
export type PeriodKey = '1m' | '3m' | '6m' | '1y' | '2y' | 'all'
export type Period = { key: PeriodKey; label: string; months: number | null } // null = 全期間
export const PERIODS: Period[]
export function resolvePeriod(key: string | undefined, fallback: PeriodKey): Period
export function periodStartDate(p: Period, today?: Date): string | null // ISO。フロント側フィルタ用
```

- 新規 `frontend/src/components/shared/period-selector.tsx`:
  searchParams ベースの Link 群(現状 Activity にある実装を一般化)。
  `basePath` と「維持する他のクエリパラメータ」(Budget の `month` 等)を props で受ける
- ラベルは `1ヶ月 / 3ヶ月 / 6ヶ月 / 1年 / 2年 / 全期間` に統一(3b の言語方針に従う)
- Activity / Budget が共用。Timeline の粒度切替(スナップショット再生)は性質が別物なので
  対象外とし、トグルの見た目(`Toggle` コンポーネント)だけ共通スタイルに揃える
- Phase 2 完了後は `months` によるフィルタをフロント側(マート読み込み後)で行うため、
  `amount`/`unit` を SQL に渡す発想自体が消える。Phase 2 以前に導入する場合は
  `Period` → `{amount, unit}` の変換関数を暫定で持つ

## 3b. 言語の統一

UI 文言は**日本語に統一**する(Timeline の説明文・カテゴリ名・単位「件」が既に日本語で、
利用者も日本語話者のため)。コード・識別子は英語のまま。

主な置き換え:

| 現状 | 変更後 |
|---|---|
| `Fitbit Dashboard`(Activity の h2) | `アクティビティ`(ソース名でなく関心事で命名) |
| `Budget` / `Timeline` | `家計` / `タイムライン` |
| `Today's Steps` ほか StatsCard | 3c 参照 |
| `Step Count Trend` 等のカードタイトル | `歩数の推移` 等 |
| `Last updated: ...` | `データ更新: ...`(Phase 2 後はソース別表示) |
| サイドバー `Activity / Budget / Timeline` | `ホーム / アクティビティ / 家計 / タイムライン` |

`metadata.title` は `Sekisyo` に統一。

## 3c. StatsCard のセマンティクス修正

### 現状の問題

「Today's Steps」「Sleep Last Night」は実際には**選択期間のデータ配列の末尾**であり、
- 今日のデータが未取得なら昨日以前の値が「Today」として出る
- period=All では月次平均が「Today's Steps」として出る

### 設計

- 最新値は選択期間と独立に取得する。Phase 2 後は `marts/daily.json` の末尾行、
  Phase 2 前の暫定では専用クエリ(`ORDER BY date DESC LIMIT 1`)
- ラベルに日付を明示して嘘をなくす: `歩数(7/4)`, `睡眠(7/3 夜)`
- `StatsCard` に `asOf?: string` prop を追加し、タイトル横に小さく日付表示

## 3d. エラーの可視化

### 現状の問題

各ページがページ全体を try/catch し、失敗時は console.error + 空配列 →
**障害が「全部ゼロの正常画面」に見える**。

### 設計

- ページ全体の try/catch をやめ、データ取得を細粒度化:
  `Promise.allSettled` で取得し、失敗したデータセットはカード単位で
  「データを取得できませんでした」表示(新規 `components/shared/data-error.tsx`)
- 全滅時(認証情報切れ等)はページ上部にエラーバナー
- `app/error.tsx` を追加して想定外の例外もハンドリング

## 3e. 統合ホーム(`/`)

### 位置づけ

`/` のリダイレクトをやめ、「今日/今週の自分」を 1 画面にする。
各ページはここからのドリルダウン先になる。**`marts/daily.json`(Phase 2)に依存**。

### レイアウト

```
┌─────────────────────────────────────────────────┐
│ 今日の状態                                        │
│ [睡眠 6.8h (7/3夜)] [歩数 8,200 (7/4)]           │
│ [今月の支出 ¥123,000] [今週の外出 5ヶ所/12h]      │
├─────────────────────────────────────────────────┤
│ 直近 7 日                                         │
│ 日付ごとの行: 睡眠バー・歩数バー・支出額・主な訪問先 │
│ (行クリックで /day/[date] へ … Phase 4)          │
├─────────────────────────────────────────────────┤
│ AI インサイト(週次レポートの最新分 … Phase 4)     │
├─────────────────────────────────────────────────┤
│ データ更新状況: Fitbit 7/4・家計簿 7/1・位置 6/30  │
└─────────────────────────────────────────────────┘
```

- 実装: `app/page.tsx` を Server Component として実装。
  `marts/daily.json` + `marts/meta.json` の 2 fetch で全部賄う
- 「直近 7 日」はチャートではなく**テーブル型のデイリーカード**にする
  (異種データの横断は折れ線を重ねるより 1 日 1 行が読みやすい)
- 集計ウィンドウは「今週/今月」のカレンダー固定ではなく **7/14/30/90 日から選択**し、
  データが存在する最新日を終点にする(2026-07 変更。家計簿・位置情報は週次同期で
  ラグがあり、カレンダー週だと直近が空に見えるため)。週次・月次の目標(04 の 4b)は
  選択期間に比例換算して達成率を出す

## 実施順

1. 3a 期間モデル + 3b 言語 + 3c StatsCard + 3d エラー(Phase 2 と独立に実施可能)
2. 3e 統合ホーム(Phase 2 の daily マート完成後)

## タスクリスト

- [ ] `lib/period.ts` / `components/shared/period-selector.tsx` 追加、Activity・Budget 適用
- [ ] UI 文言の日本語統一(上記対訳表)
- [ ] `StatsCard` の最新値分離 + `asOf` 表示
- [ ] `Promise.allSettled` 化 + カード単位エラー表示 + `app/error.tsx`
- [ ] 統合ホーム実装(Phase 2 後)
