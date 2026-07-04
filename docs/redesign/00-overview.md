# Sekisyo 再設計 全体像

「データソースごとの個別ビューアの寄せ集め」から「生活を日付軸で横断的に見るダッシュボード」への再設計。
コードベースレビュー(2026-07)で特定した問題と、その修正の全体像・優先順位をまとめる。

## 診断サマリ

| # | 問題 | レイヤ | 詳細設計 |
|---|---|---|---|
| 1 | `athena-actions.ts` に SQL インジェクション(budget/timeline は対策済みで姿勢が不統一) | セキュリティ | [01-security.md](./01-security.md) |
| 2 | ダッシュボードに認証がない(健康・位置・家計データが公開 POST で引ける) | セキュリティ | [01-security.md](./01-security.md) |
| 3 | 表示のたびに Athena を 5〜6 クエリ直列ポーリング(数秒〜十数秒 + スキャン課金)。データは日次更新なのにキャッシュなし | データ層 | [02-data-layer.md](./02-data-layer.md) |
| 4 | 集計ロジックが SQL 文字列としてフロント 3 ファイルに散在。日付形式も `YYYY-MM-DD` と `Y/m/d` が混在し横断集計の共通キーがない | データ層 | [02-data-layer.md](./02-data-layer.md) |
| 5 | 期間セレクタが 3 ページで別実装・別セマンティクス。UI 言語(英/日)も混在 | UI | [03-ui-unification.md](./03-ui-unification.md) |
| 6 | ホームが `/activity` へのリダイレクトのみで「今週の自分」を見る場所がない | UI / 機能 | [03-ui-unification.md](./03-ui-unification.md) |
| 7 | ソース横断の機能(デイビュー・相関・目標・AI インサイト)が存在しない | 機能 | [04-cross-features.md](./04-cross-features.md) |
| 8 | 細部: エラー握りつぶしで「全部ゼロの正常画面」/ StatsCard の「Today's」が実際は期間末尾の値 / README が雛形のまま | 品質 | 各ドキュメント内 |

## フェーズと依存関係

```
Phase 1: 安全の確保(即日〜数日)          … 01-security
  ├─ 1a. athena-actions の SQLi 修正        依存なし。最優先
  └─ 1b. Cloudflare Access 導入             依存なし

Phase 2: データ層の統一(土台)             … 02-data-layer
  └─ ETL 最終段にマートビルダー Lambda を追加し、
     集計済み JSON を S3 に出力。フロントの表示パスから Athena を外す

Phase 3: UI の統一                          … 03-ui-unification
  ├─ 共通期間モデル / PeriodSelector        Phase 2 と並行可
  ├─ 言語統一・エラー表示・StatsCard 修正   Phase 2 と並行可
  └─ 統合ホーム                             Phase 2 の daily マートに依存

Phase 4: 横断機能                           … 04-cross-features
  ├─ デイビュー(/day/[date])              Phase 2 に依存
  ├─ 目標・予算設定                         Phase 2 に依存
  ├─ 相関ビュー                             Phase 2 に依存
  └─ 週次 AI インサイト                     Phase 2 に依存。docs/ai-agent-design.md 案 1 と統合
```

Phase 1 は他と独立なので必ず先行させる。Phase 2 が全体の土台で、
ここを終えると「集計ロジックの散在」「表示の遅さ」「横断キーの欠如」が同時に解消し、
Phase 3・4 は薄い UI 実装になる。

## 変更しないもの

- ETL 3 本(fitbit / gdrive / timeline)の取得・格納ロジック(日付正規化のみ Phase 2 で追加)
- Athena / Glue 自体は撤去しない。アドホック分析と AI エージェント(ai-agent-design.md)の
  探索用に残す。撤去するのは「フロント表示パスでの利用」のみ
- Cloudflare Pages でのホスティング、Terraform / Docker Lambda のデプロイパターン

## 関連ドキュメント

- [01-security.md](./01-security.md) — SQLi 修正・Cloudflare Access・IAM 最小権限
- [02-data-layer.md](./02-data-layer.md) — マートビルダー Lambda・S3 JSON マート・フロント移行
- [03-ui-unification.md](./03-ui-unification.md) — 期間モデル統一・言語統一・統合ホーム
- [04-cross-features.md](./04-cross-features.md) — デイビュー・相関・目標・通知
- [../ai-agent-design.md](../ai-agent-design.md) — AI エージェント機能(既存設計。Phase 4 で接続)
