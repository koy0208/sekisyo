// marts/*.json の型定義 (docs/redesign/02-data-layer.md)。
// 生成側 etl/mart_builder/lambda_function.py と手動で同期する。

export type MartMeta = {
  generated_at: string
  sources: {
    fitbit: { last_date: string | null }
    budget: { last_date: string | null }
    timeline: { first_date: string | null; last_date: string | null }
  }
}

// marts/activity_daily.json
export type ActivityDailyRow = {
  date: string
  steps: number | null
  steps_ma: number | null
  sleep_hours: number | null
  sleep_hours_ma: number | null
  sleep_start: string | null // "23:40"
  sleep_end: string | null
  active_zone_min: number | null
  active_zone_ma: number | null
  low_intensity_min: number | null
  low_intensity_ma: number | null
}

// marts/activity_monthly.json (period=All 用の月次平均)
export type ActivityMonthlyRow = {
  month: string // "2026-07"
  steps: number | null
  sleep_hours: number | null
  active_zone_min: number | null
  low_intensity_min: number | null
}

// marts/budget_monthly.json
export type BudgetMonthlyRow = {
  month: string
  expense_total: number
  income_total: number
  transaction_count: number
  expense_by_category: Record<string, number>
  income_by_category: Record<string, number>
}

// marts/budget_daily.json (日 × カテゴリの素データ。累積・トレンドはフロントで導出)
export type BudgetDailyRow = {
  date: string
  kind: 'expense' | 'income'
  category: string
  amount: number
}

// marts/timeline_ranking.json
export type TimelineRankingRow = {
  mon: string
  place_id: string
  place_name: string | null
  uri: string | null
  lat: number | null
  lng: number | null
  visits: number
  hours: number
}

// marts/timeline_place_visits.json (場所ドリルダウン。place_id 絞り込みはサーバ側で行う)
export type TimelinePlaceVisitRow = {
  place_id: string
  date: string
  dow: string
  in_t: string
  out_t: string
  dur: number
}

// marts/timeline_days/{date}.json の 1 イベント
export type TimelineDayEventRow = {
  kind: 'visit' | 'move'
  date: string
  in_t: string
  out_t: string
  dur: number
  label: string | null
  type_code: string | null
  place_id: string | null
  uri: string | null
  lat: number | null
  lng: number | null
  end_lat: number | null
  end_lng: number | null
  dist_m: number | null
}

// marts/budget_transactions/{YYYY-MM}.json (デイビューの支出明細用)
export type BudgetTransactionRow = {
  date: string
  description: string | null
  amount: number
  major_category: string
  sub_category: string
  kind: 'expense' | 'income'
}

// marts/daily.json (横断機能の基盤: 統合ホーム・デイビュー・相関ビュー用)
export type DailyRow = {
  date: string
  steps: number | null
  sleep_hours: number | null
  sleep_start: string | null
  sleep_end: string | null
  active_zone_min: number | null
  low_intensity_min: number | null
  spending_total: number | null
  spending_by_category?: Record<string, number>
  visit_count: number | null
  out_hours: number | null
  top_places?: { place_id: string; name: string; min: number }[]
}
