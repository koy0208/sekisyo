import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { CategoryBreakdownChart } from "@/components/budget/budget-charts"
import { CumulativeSpendingCard } from "@/components/budget/cumulative-spending-card"
import { DailyCategoryCard } from "@/components/budget/daily-category-card"
import { PeriodSelector } from "@/components/shared/period-selector"
import { DataError } from "@/components/shared/data-error"
import { MonthPicker } from "@/components/budget/month-picker"
import { fetchMart } from "@/lib/marts"
import { type BudgetDailyRow, type BudgetMonthlyRow } from "@/lib/mart-types"
import { resolvePeriod, periodCutoff, type Period } from "@/lib/period"
import { GOALS } from "@/config/goals"
import { Wallet, Receipt, Tags, TrendingUp } from "lucide-react"
import { settle, weekStart } from "@/lib/utils"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

function getCurrentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function getPrevYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `${y}年${m}月`
}

// 日次マートを期間で絞り、週次 (1年未満) または月次 (1年以上・全期間) に再集計する
function bucketTrend(rows: BudgetDailyRow[], kind: BudgetDailyRow['kind'], period: Period) {
  const cutoff = periodCutoff(period)
  const monthly = period.months == null || period.months >= 12
  // date_key → (category → 合計)。カテゴリ名に区切り文字の制約を持ち込まない
  const totals = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (row.kind !== kind) continue
    if (cutoff != null && row.date < cutoff) continue
    const dateKey = monthly ? row.date.slice(0, 7) : weekStart(row.date)
    const byCategory = totals.get(dateKey) ?? new Map<string, number>()
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount)
    totals.set(dateKey, byCategory)
  }
  return Array.from(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date_key, byCategory]) =>
      Array.from(byCategory, ([category, daily_total]) => ({ date_key, category, daily_total }))
    )
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; period?: string }>
}) {
  const params = await searchParams
  const targetMonth = params.month || getCurrentYearMonth()
  const prevMonth = getPrevYearMonth(targetMonth)
  const period = resolvePeriod(params.period, '3m')

  const [monthlyMart, dailyMart] = await Promise.all([
    settle(fetchMart<BudgetMonthlyRow[]>("budget_monthly.json"), "budget monthly mart"),
    settle(fetchMart<BudgetDailyRow[]>("budget_daily.json"), "budget daily mart"),
  ])

  const target = monthlyMart?.find((m) => m.month === targetMonth)
  const prev = monthlyMart?.find((m) => m.month === prevMonth)

  // 累積支出チャート用: 対象月と前月の日 × カテゴリ (支出のみ)
  const dailyCategoryData = dailyMart
    ?.filter((r) => r.kind === 'expense' && (r.date.startsWith(targetMonth) || r.date.startsWith(prevMonth)))
    .map((r) => ({
      month: r.date.slice(0, 7),
      day_of_month: Number(r.date.slice(8, 10)),
      major_category: r.category,
      daily_total: r.amount,
    })) ?? null

  // カテゴリ内訳 (金額降順)。カテゴリフィルタ UI もこの並び順を使う
  const categoryData = target
    ? Object.entries(target.expense_by_category)
        .map(([major_category, total_amount]) => ({ major_category, total_amount }))
        .sort((a, b) => b.total_amount - a.total_amount)
    : monthlyMart ? [] : null
  const allCategories = categoryData?.map((c) => c.major_category) ?? []

  const totalAmount = target?.expense_total ?? 0
  const transactionCount = target?.transaction_count ?? 0
  const categoryCount = target ? Object.keys(target.expense_by_category).length : 0

  // 前月比
  let deltaPercent: number | null = null
  if (target && prev && prev.expense_total > 0) {
    deltaPercent = ((target.expense_total - prev.expense_total) / prev.expense_total) * 100
  }

  const spendingTrend = dailyMart ? bucketTrend(dailyMart, 'expense', period) : null
  const spendingCategories = Array.from(new Set((spendingTrend ?? []).map(r => r.category)))

  const incomeTrend = dailyMart ? bucketTrend(dailyMart, 'income', period) : null
  const incomeCategories = Array.from(new Set((incomeTrend ?? []).map(r => r.category)))

  const allFailed = !monthlyMart && !dailyMart

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">家計</h2>
          <MonthPicker currentMonth={targetMonth} />
        </div>

        {allFailed && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            データの取得に失敗しました。時間をおいて再読み込みしてください。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="支出合計"
            value={monthlyMart ? `¥${totalAmount.toLocaleString()}` : "—"}
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
            delta={deltaPercent}
            deltaLabel="前月比"
            progress={target ? { current: Math.abs(totalAmount), target: GOALS.budget_per_month, lowerIsBetter: true } : undefined}
          />
          <StatsCard
            title="取引数"
            value={monthlyMart ? transactionCount : "—"}
            unit="件"
            icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="カテゴリ数"
            value={monthlyMart ? categoryCount : "—"}
            icon={<Tags className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="最多カテゴリ"
            value={categoryData?.length ? categoryData[0].major_category : "—"}
            description={categoryData?.length ? `¥${categoryData[0].total_amount.toLocaleString()}` : undefined}
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {dailyCategoryData ? (
            <CumulativeSpendingCard
              data={dailyCategoryData}
              categories={allCategories}
              currentLabel={formatYearMonth(targetMonth)}
              previousLabel={formatYearMonth(prevMonth)}
              targetMonth={targetMonth}
              budgetLine={-GOALS.budget_per_month}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>累積支出</CardTitle>
              </CardHeader>
              <CardContent>
                <DataError />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>カテゴリ内訳({formatYearMonth(targetMonth)})</CardTitle>
            </CardHeader>
            <CardContent>
              {categoryData ? <CategoryBreakdownChart data={categoryData} /> : <DataError />}
            </CardContent>
          </Card>
        </div>

        <PeriodSelector basePath="/budget" currentKey={period.key} extraParams={{ month: targetMonth }} />

        <div className="grid gap-4 md:grid-cols-2">
          {spendingTrend ? (
            <DailyCategoryCard
              data={spendingTrend}
              categories={spendingCategories}
              title="支出の推移"
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>支出の推移</CardTitle>
              </CardHeader>
              <CardContent>
                <DataError />
              </CardContent>
            </Card>
          )}
          {incomeTrend ? (
            <DailyCategoryCard
              data={incomeTrend}
              categories={incomeCategories}
              title="収入の推移"
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>収入の推移</CardTitle>
              </CardHeader>
              <CardContent>
                <DataError />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
