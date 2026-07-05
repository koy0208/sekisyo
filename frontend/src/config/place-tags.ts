// place_id → タグ名の手動マッピング (docs/redesign/04-cross-features.md 4d)。
// 相関ビューで「この場所に行った日 / 行かない日」の比較に使う。
// place_id はタイムラインの場所クリック時の明細や marts/timeline_ranking.json から調べて追記する。

export const PLACE_TAGS: Record<string, string> = {
  // 例: "ChIJN1t_tDeuEmsRUsoyG83frY4": "ジム",
}
