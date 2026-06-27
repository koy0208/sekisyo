'use server'

import { runAthenaQuery } from "@/lib/athena";

const BUDGET_DB = 'sekisyo'

// Server Action は実体が公開 POST エンドポイントで、引数の TS 型は実行時に
// 強制されない。SQL に直接埋め込む値はここで必ず検証する（SQL インジェクション対策）。
function assertYearMonth(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`)
  }
  return yearMonth
}

// interval の単位は固定の allowlist のみ許可する
const ALLOWED_UNITS = new Set(['day', 'week', 'month', 'year'])
function assertUnit(unit: string): string {
  if (!ALLOWED_UNITS.has(unit)) {
    throw new Error(`Invalid unit: ${unit}`)
  }
  return unit
}

// interval の数量は正の整数のみ許可する
function assertAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`)
  }
  return amount
}

function prevMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 2, 1) // month is 0-indexed, so m-2 gives previous month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function getDailyCumulativeSpending(yearMonth: string) {
  assertYearMonth(yearMonth)
  const prev = prevMonth(yearMonth)
  const query = `
    WITH daily AS (
      SELECT
        date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') as month,
        day(date_parse(date, '%Y/%m/%d')) as day_of_month,
        SUM(CAST(amount AS INTEGER)) as daily_total
      FROM household_budget
      WHERE CAST(calculation_target AS INTEGER) = 1
        AND CAST(transfer AS INTEGER) = 0
        AND major_category <> '収入'
        AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') IN ('${yearMonth}', '${prev}')
      GROUP BY
        date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m'),
        day(date_parse(date, '%Y/%m/%d'))
    )
    SELECT
      month,
      day_of_month,
      daily_total,
      SUM(daily_total) OVER (PARTITION BY month ORDER BY day_of_month) as cumulative_total
    FROM daily
    ORDER BY month, day_of_month
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getCategoryBreakdown(yearMonth: string) {
  assertYearMonth(yearMonth)
  const query = `
    SELECT
      major_category,
      SUM(CAST(amount AS INTEGER)) as total_amount
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category <> '収入'
      AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') = '${yearMonth}'
    GROUP BY major_category
    ORDER BY total_amount DESC
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getMonthSummary(yearMonth: string) {
  assertYearMonth(yearMonth)
  const query = `
    SELECT
      SUM(CAST(amount AS INTEGER)) as total_amount,
      COUNT(DISTINCT major_category) as category_count,
      COUNT(*) as transaction_count
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category <> '収入'
      AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') = '${yearMonth}'
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getDailyCategorySpending(yearMonth: string) {
  assertYearMonth(yearMonth)
  const prev = prevMonth(yearMonth)
  const query = `
    SELECT
      date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') as month,
      day(date_parse(date, '%Y/%m/%d')) as day_of_month,
      major_category,
      SUM(CAST(amount AS INTEGER)) as daily_total
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category <> '収入'
      AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') IN ('${yearMonth}', '${prev}')
    GROUP BY
      date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m'),
      day(date_parse(date, '%Y/%m/%d')),
      major_category
    ORDER BY month, day_of_month
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getDailySpendingByPeriod(amount?: number, unit?: string) {
  const isAll = amount === undefined || unit === undefined
  const safeAmount = isAll ? 0 : assertAmount(amount!)
  const safeUnit = isAll ? '' : assertUnit(unit!)
  const isMonthly = isAll || safeUnit === 'year'
  const dateKey = isMonthly
    ? "date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m')"
    : "date_format(date_trunc('week', date_parse(date, '%Y/%m/%d')), '%Y-%m-%d')"
  const whereClause = isAll
    ? ''
    : `AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m-%d') >= date_format(current_date - interval '${safeAmount}' ${safeUnit}, '%Y-%m-%d')`
  const query = `
    SELECT
      ${dateKey} as date_key,
      major_category,
      SUM(CAST(amount AS INTEGER)) as daily_total
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category <> '収入'
      ${whereClause}
    GROUP BY ${dateKey}, major_category
    ORDER BY date_key
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getDailyIncomeByPeriod(amount?: number, unit?: string) {
  const isAll = amount === undefined || unit === undefined
  const safeAmount = isAll ? 0 : assertAmount(amount!)
  const safeUnit = isAll ? '' : assertUnit(unit!)
  const isMonthly = isAll || safeUnit === 'year'
  const dateKey = isMonthly
    ? "date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m')"
    : "date_format(date_trunc('week', date_parse(date, '%Y/%m/%d')), '%Y-%m-%d')"
  const whereClause = isAll
    ? ''
    : `AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m-%d') >= date_format(current_date - interval '${safeAmount}' ${safeUnit}, '%Y-%m-%d')`
  const query = `
    SELECT
      ${dateKey} as date_key,
      sub_category as category,
      SUM(CAST(amount AS INTEGER)) as daily_total
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category = '収入'
      ${whereClause}
    GROUP BY ${dateKey}, sub_category
    ORDER BY date_key
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getMonthComparison(yearMonth: string) {
  assertYearMonth(yearMonth)
  const prev = prevMonth(yearMonth)
  const query = `
    SELECT
      date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') as month,
      SUM(CAST(amount AS INTEGER)) as total_amount
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category <> '収入'
      AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m') IN ('${yearMonth}', '${prev}')
    GROUP BY date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m')
    ORDER BY month ASC
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}
