'use server'

import { runAthenaQuery } from "@/lib/athena";

const BUDGET_DB = 'sekisyo'

function prevMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 2, 1) // month is 0-indexed, so m-2 gives previous month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function getDailyCumulativeSpending(yearMonth: string) {
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
  const dateKey = isAll
    ? "date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m')"
    : "date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m-%d')"
  const whereClause = isAll
    ? ''
    : `AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m-%d') >= date_format(current_date - interval '${amount}' ${unit}, '%Y-%m-%d')`
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
  const dateKey = isAll
    ? "date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m')"
    : "date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m-%d')"
  const whereClause = isAll
    ? ''
    : `AND date_format(date_parse(date, '%Y/%m/%d'), '%Y-%m-%d') >= date_format(current_date - interval '${amount}' ${unit}, '%Y-%m-%d')`
  const query = `
    SELECT
      ${dateKey} as date_key,
      middle_category as category,
      SUM(CAST(amount AS INTEGER)) as daily_total
    FROM household_budget
    WHERE CAST(calculation_target AS INTEGER) = 1
      AND CAST(transfer AS INTEGER) = 0
      AND major_category = '収入'
      ${whereClause}
    GROUP BY ${dateKey}, middle_category
    ORDER BY date_key
  `;
  return await runAthenaQuery(query, BUDGET_DB);
}

export async function getMonthComparison(yearMonth: string) {
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
