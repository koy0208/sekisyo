import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { CategoryBreakdownChart } from "@/components/budget/budget-charts"
import { CumulativeSpendingCard } from "@/components/budget/cumulative-spending-card"
import { DailyCategoryCard } from "@/components/budget/daily-category-card"
import { getDailyCategorySpending, getCategoryBreakdown, getMonthSummary, getMonthComparison, getDailySpendingByPeriod, getDailyIncomeByPeriod } from "@/app/actions/budget-actions"
import { MonthPicker } from "@/components/budget/month-picker"
import { Wallet, Receipt, Tags, TrendingUp } from "lucide-react"
import { AthenaRow } from "@/lib/athena"
import Link from "next/link"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

type PeriodOption = {
  label: string
  amount?: number
  unit?: string
  key: string
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { label: "1M", amount: 1, unit: "month", key: "1m" },
  { label: "3M", amount: 3, unit: "month", key: "3m" },
  { label: "6M", amount: 6, unit: "month", key: "6m" },
  { label: "1Y", amount: 1, unit: "year", key: "1y" },
  { label: "2Y", amount: 2, unit: "year", key: "2y" },
  { label: "All", key: "all" },
]

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
  const currentPeriodKey = params.period || "3m"
  const selectedPeriod = PERIOD_OPTIONS.find(p => p.key === currentPeriodKey) || PERIOD_OPTIONS[1]

  let dailyCategoryData: { month: string; day_of_month: number; major_category: string; daily_total: number }[] = []
  let allCategories: string[] = []
  let categoryData: { major_category: string; total_amount: number }[] = []
  let totalAmount = 0
  let transactionCount = 0
  let categoryCount = 0
  let deltaPercent: number | null = null
  let spendingTrend: { date_key: string; category: string; daily_total: number }[] = []
  let spendingCategories: string[] = []
  let incomeTrend: { date_key: string; category: string; daily_total: number }[] = []
  let incomeCategories: string[] = []

  try {
    const [rawDailyCategory, rawCategory, rawSummary, rawComparison, rawSpendingTrend, rawIncomeTrend] = await Promise.all([
      getDailyCategorySpending(targetMonth),
      getCategoryBreakdown(targetMonth),
      getMonthSummary(targetMonth),
      getMonthComparison(targetMonth),
      getDailySpendingByPeriod(selectedPeriod.amount, selectedPeriod.unit),
      getDailyIncomeByPeriod(selectedPeriod.amount, selectedPeriod.unit),
    ])

    // Process daily category data
    dailyCategoryData = rawDailyCategory.map((row: AthenaRow) => ({
      month: row.month || '',
      day_of_month: Number(row.day_of_month),
      major_category: row.major_category || '不明',
      daily_total: Number(row.daily_total || 0),
    }))

    // Process category data
    categoryData = rawCategory.map((row: AthenaRow) => ({
      major_category: row.major_category || "不明",
      total_amount: Number(row.total_amount || 0),
    }))

    // Use category breakdown order (by total amount desc) for filter UI
    allCategories = categoryData.map((c) => c.major_category)

    // Process summary
    if (rawSummary.length > 0) {
      totalAmount = Number(rawSummary[0].total_amount || 0)
      transactionCount = Number(rawSummary[0].transaction_count || 0)
      categoryCount = Number(rawSummary[0].category_count || 0)
    }

    // Process comparison for MoM delta
    let currentTotal = 0
    let prevTotal = 0
    for (const row of rawComparison) {
      if (row.month === targetMonth) currentTotal = Number(row.total_amount || 0)
      else prevTotal = Number(row.total_amount || 0)
    }
    if (prevTotal > 0) {
      deltaPercent = ((currentTotal - prevTotal) / prevTotal) * 100
    }

    // Process spending trend
    spendingTrend = rawSpendingTrend.map((row: AthenaRow) => ({
      date_key: row.date_key || '',
      category: row.major_category || '不明',
      daily_total: Number(row.daily_total || 0),
    }))
    const spendingCatSet = new Set(spendingTrend.map(r => r.category))
    spendingCategories = Array.from(spendingCatSet)

    // Process income trend
    incomeTrend = rawIncomeTrend.map((row: AthenaRow) => ({
      date_key: row.date_key || '',
      category: row.category || '不明',
      daily_total: Number(row.daily_total || 0),
    }))
    const incomeCatSet = new Set(incomeTrend.map(r => r.category))
    incomeCategories = Array.from(incomeCatSet)
  } catch (error) {
    console.error("Failed to fetch budget data from Athena:", error)
  }

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Budget</h2>
          <MonthPicker currentMonth={targetMonth} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Total Spending"
            value={`¥${totalAmount.toLocaleString()}`}
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
            delta={deltaPercent}
            deltaLabel="vs prev month"
          />
          <StatsCard
            title="Transactions"
            value={transactionCount}
            unit="件"
            icon={<Receipt className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="Categories"
            value={categoryCount}
            icon={<Tags className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="Top Category"
            value={categoryData.length > 0 ? categoryData[0].major_category : "-"}
            description={categoryData.length > 0 ? `¥${categoryData[0].total_amount.toLocaleString()}` : undefined}
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <CumulativeSpendingCard
            data={dailyCategoryData}
            categories={allCategories}
            currentLabel={formatYearMonth(targetMonth)}
            previousLabel={formatYearMonth(prevMonth)}
            targetMonth={targetMonth}
          />
          <Card>
            <CardHeader>
              <CardTitle>Category Breakdown ({formatYearMonth(targetMonth)})</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBreakdownChart data={categoryData} />
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center space-x-1">
          {PERIOD_OPTIONS.map((opt) => (
            <Link
              key={opt.key}
              href={`/budget?month=${targetMonth}&period=${opt.key}`}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                currentPeriodKey === opt.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <DailyCategoryCard
            data={spendingTrend}
            categories={spendingCategories}
            title="Spending Trend"
          />
          <DailyCategoryCard
            data={incomeTrend}
            categories={incomeCategories}
            title="Income Trend"
          />
        </div>
      </div>
    </div>
  )
}
