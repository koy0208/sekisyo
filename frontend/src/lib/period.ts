// ページ横断で共有する期間モデル(docs/redesign/03-ui-unification.md)。
// Activity / Budget で別実装・別ラベルだった期間セレクタを一本化する。

export type PeriodKey = '1m' | '3m' | '6m' | '1y' | '2y' | 'all'

export type Period = {
  key: PeriodKey
  label: string
  months: number | null // null = 全期間
}

export const PERIODS: Period[] = [
  { key: '1m', label: '1ヶ月', months: 1 },
  { key: '3m', label: '3ヶ月', months: 3 },
  { key: '6m', label: '6ヶ月', months: 6 },
  { key: '1y', label: '1年', months: 12 },
  { key: '2y', label: '2年', months: 24 },
  { key: 'all', label: '全期間', months: null },
]

export function resolvePeriod(key: string | undefined, fallback: PeriodKey = '1m'): Period {
  return PERIODS.find((p) => p.key === key) ?? PERIODS.find((p) => p.key === fallback)!
}

// Athena の interval 句用の暫定変換。マート移行(docs/redesign/02-data-layer.md)後は
// フロント側フィルタに置き換えて削除する
export function periodToInterval(p: Period): { amount: number; unit: 'month' | 'year' } | null {
  if (p.months == null) return null
  return p.months % 12 === 0
    ? { amount: p.months / 12, unit: 'year' }
    : { amount: p.months, unit: 'month' }
}
