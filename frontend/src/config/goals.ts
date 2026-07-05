// 目標・予算の設定 (docs/redesign/04-cross-features.md 4b)。
// 個人利用で変更頻度が低いため設定 UI は作らず、コード管理で git 履歴に残す。
// 将来設定 UI が欲しくなったら marts/config.json (S3) に移す。

export const GOALS = {
  steps_per_day: 8000,
  sleep_hours_min: 7.0,
  active_zone_min_per_week: 150, // WHO 推奨
  budget_per_month: 200000, // 変動費の月予算 (円)
} as const
