import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { CategoryBreakdownChart } from "@/components/budget/budget-charts"
import { CumulativeSpendingCard } from "@/components/budget/cumulative-spending-card"
import { DailyCategoryCard } from "@/components/budget/daily-category-card"
import { PeriodSelector } from "@/components/shared/period-selector"
import { DataError } from "@/components/shared/data-error"
import { getDailyCategorySpending, getCategoryBreakdown, getMonthSummary, getMonthComparison, getDailySpendingByPeriod, getDailyIncomeByPeriod } from "@/app/actions/budget-actions"
import { MonthPicker } from "@/components/budget/month-picker"
import { resolvePeriod, periodToInterval } from "@/lib/period"
import { Wallet, Receipt, Tags, TrendingUp } from "lucide-react"
import { AthenaRow } from "@/lib/athena"
import { settle } from "@/lib/utils"

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

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; period?: string }>
}) {
  const params = await searchParams
  const targetMonth = params.month || getCurrentYearMonth()
  const prevMonth = getPrevYearMonth(targetMonth)
  const period = resolvePeriod(params.period, '3m')
  const interval = periodToInterval(period)

  const [rawDailyCategory, rawCategory, rawSummary, rawComparison, rawSpendingTrend, rawIncomeTrend] = await Promise.all([
    settle(getDailyCategorySpending(targetMonth), "daily category"),
    settle(getCategoryBreakdown(targetMonth), "category breakdown"),
    settle(getMonthSummary(targetMonth), "month summary"),
    settle(getMonthComparison(targetMonth), "month comparison"),
    settle(getDailySpendingByPeriod(interval?.amount, interval?.unit), "spending trend"),
    settle(getDailyIncomeByPeriod(interval?.amount, interval?.unit), "income trend"),
  ])

  const dailyCategoryData = rawDailyCategory?.map((row: AthenaRow) => ({
    month: row.month || '',
    day_of_month: Number(row.day_of_month),
    major_category: row.major_category || '不明',
    daily_total: Number(row.daily_total || 0),
  })) ?? null

  const categoryData = rawCategory?.map((row: AthenaRow) => ({
    major_category: row.major_category || "不明",
    total_amount: Number(row.total_amount || 0),
  })) ?? null

  // カテゴリフィルタ UI は内訳(金額降順)の並び順を使う
  const allCategories = categoryData?.map((c) => c.major_category) ?? []

  const summary = rawSummary?.[0]
  const totalAmount = Number(summary?.total_amount || 0)
  const transactionCount = Number(summary?.transaction_count || 0)
  const categoryCount = Number(summary?.category_count || 0)

  // 前月比
  let deltaPercent: number | null = null
  if (rawComparison) {
    let currentTotal = 0
    let prevTotal = 0
    for (const row of rawComparison) {
      if (row.month === targetMonth) currentTotal = Number(row.total_amount || 0)
      else prevTotal = Number(row.total_amount || 0)
    }
    if (prevTotal > 0) {
      deltaPercent = ((currentTotal - prevTotal) / prevTotal) * 100
    }
  }

  const spendingTrend = rawSpendingTrend?.map((row: AthenaRow) => ({
    date_key: row.date_key || '',
    category: row.major_category || '不明',
    daily_total: Number(row.daily_total || 0),
  })) ?? null
  const spendingCategories = Array.from(new Set((spendingTrend ?? []).map(r => r.category)))

  const incomeTrend = rawIncomeTrend?.map((row: AthenaRow) => ({
    date_key: row.date_key || '',
    category: row.category || '不明',
    daily_total: Number(row.daily_total || 0),
  })) ?? null
  const incomeCategories = Array.from(new Set((incomeTrend ?? []).map(r => r.category)))

  const allFailed = !rawDailyCategory && !rawCategory && !rawSummary && !rawSpendingTrend

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
            value={summary ? `¥${totalAmount.toLocaleString()}` : "—"}
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
            delta={deltaPercent}
            deltaLabel="前月比"
          />
          <StatsCard
            title="取引数"
            value={summary ? transactionCount : "—"}
            unit="件"
            icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="カテゴリ数"
            value={summary ? categoryCount : "—"}
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
