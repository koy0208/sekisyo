# Phase 1: セキュリティ詳細設計

対象: SQL インジェクション修正 / ダッシュボード認証 / IAM 最小権限 / 細部の衛生。
他フェーズに依存しないため最優先で実施する。

## 1a. `athena-actions.ts` の SQL インジェクション修正

### 現状と問題

Server Action は実体が公開 POST エンドポイントであり、TS の型は実行時に強制されない
(`budget-actions.ts` 冒頭のコメントに同じ認識が既に書かれている)。

| ファイル | 状態 |
|---|---|
| `frontend/src/app/actions/budget-actions.ts` | `assertYearMonth` / `assertUnit` / `assertAmount` で対策済み(c270b3c) |
| `frontend/src/app/actions/timeline-actions.ts` | シングルクオートのエスケープで対策済み |
| `frontend/src/app/actions/athena-actions.ts` | **無対策**。`getActivity` / `getLowIntensity` / `getSleep` / `getSteps` が `interval '${amount}' ${unit}` を無検証で SQL に埋め込む |

`unit` に任意文字列を渡せるため、認証がない現状では外部から任意の Athena SQL 断片を
実行できる(読み取り専用 IAM でも全テーブルの内容が引ける)。

### 設計

バリデーションを 1 箇所に集約し、3 つの action ファイルすべてが同じガードを通る構造にする。

- 新規: `frontend/src/lib/query-guards.ts`
  - `assertAmount(n: number): number` — 正の整数のみ許可
  - `assertUnit(u: string): string` — allowlist `['day', 'week', 'month', 'year']` のみ許可
  - `assertYearMonth(s: string): string` — `/^\d{4}-\d{2}$/` のみ許可
  - `escapeSqlString(s: string): string` — `'` → `''`(timeline の place_id / date 用)
- `athena-actions.ts`: 各関数の非 `all` パス冒頭で `assertAmount` / `assertUnit` を呼ぶ。
  `unit === 'all'` は既存どおりクエリ分岐で処理し、`'all'` という文字列自体は SQL に埋め込まない
- `budget-actions.ts` / `timeline-actions.ts`: ローカル実装を削除して `query-guards` を import
  (挙動は不変。実装の一本化のみ)

### 検証

- `npm run lint` / `npm run build`
- 不正値(`unit: "month' --"` 等)で各 action が throw することをユニットレベルで確認
  (テスト基盤が無いため、最低限ビルド + 手動確認。テスト導入は別課題)

## 1b. Cloudflare Access によるダッシュボード認証

### 方針

アプリ側にログイン実装を持ち込まず、Cloudflare Zero Trust の Access で
Pages プロジェクト全体(production + preview)を保護する。個人利用のため
ポリシーは「自分のメールアドレスのみ許可」で十分。

Server Actions は同一オリジンへの POST なので、Access で保護されたオリジンの
背後に自動的に入る(未認証リクエストは Access のログイン画面にリダイレクトされ、
action まで到達しない)。

### 設定手順(Cloudflare ダッシュボード操作。コード変更なし)

1. Zero Trust → Access → Applications → Add an application → **Self-hosted**
2. Application domain:
   - `sekisyo.pages.dev`(production)
   - `*.sekisyo.pages.dev`(preview デプロイも保護)
   - カスタムドメインがあれば同様に追加
3. Policy: Allow / Include = Emails → 自分のメールアドレス
4. 認証方式: One-time PIN(メール PIN。IdP 設定不要で最小工数)。
   Google ログインにしたければ後から IdP 追加で置き換え可能
5. Session duration: 1 週間程度(個人端末のみの想定)

### 将来との整合

- AI エージェント API(ai-agent-design.md 案 2)を追加する際は、ブラウザ経由は同じ
  Access で保護し、プログラム経由が必要になったら Access の **Service Token** を使う
- Access 導入後も 1a のバリデーションは維持する(多層防御。Access の設定ミスや
  preview URL の保護漏れに対する保険)

## 1c. IAM 最小権限の確認

フロントが使う IAM ユーザーは `streamlit-athena-user`
(`infrastructure/lambda/main.tf`。名前が旧構成のままなのもリネーム候補)。
以下を確認し、超過分があれば削る:

- `athena:StartQueryExecution` / `GetQueryExecution` / `GetQueryResults`(workgroup `sekisyo-workgroup` に限定)
- `glue:GetDatabase` / `GetTable` / `GetPartitions`(対象 DB のみ)
- `s3:GetObject` はデータバケットの読み取りと Athena 結果バケットのみ。
  **`s3:PutObject` はAthena 結果バケット(`sekisyo-athena-results`)以外に付与しない**

Phase 2 でマート JSON の読み取り(`s3:GetObject` on `marts/**`)を追加する。

## 1d. 細部の衛生

- `etl/gdrive_to_s3/sekisyo-27ac7934e321.json`(Google サービスアカウント鍵)は
  git 管理外だが Docker ビルドコンテキスト内にある。Dockerfile は COPY していないものの、
  事故防止のためリポジトリ外(例: `~/.config/sekisyo/`)へ移動する。
  実行時は Secrets Manager `prod/dashboard/gdrive` から読む構成が既にあるため、ローカルに置く必然性がない
- ルートの `default.profraw` を削除(287d962 で gitignore 済み。実ファイルの掃除のみ)

## タスクリスト

- [ ] `frontend/src/lib/query-guards.ts` 新規作成
- [ ] `athena-actions.ts` にガード適用
- [ ] `budget-actions.ts` / `timeline-actions.ts` を共通ガードに移行
- [ ] Cloudflare Access アプリケーション作成(ダッシュボード操作、要ユーザー実施)
- [ ] IAM ポリシー確認・縮小(Terraform)
- [ ] サービスアカウント鍵の移動 / profraw 削除
