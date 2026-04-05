import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { CumulativeSpendingChart, CategoryBreakdownChart } from "@/components/budget/budget-charts"
import { getDailyCumulativeSpending, getCategoryBreakdown, getMonthSummary, getMonthComparison } from "@/app/actions/budget-actions"
import { MonthPicker } from "@/components/budget/month-picker"
import { Wallet, Receipt, Tags, TrendingUp } from "lucide-react"
import { AthenaRow } from "@/lib/athena"

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
  searchParams: Promise<{ month?: string }>
}) {
  const targetMonth = (await searchParams).month || getCurrentYearMonth()
  const prevMonth = getPrevYearMonth(targetMonth)

  const cumulativeData: { day: number; current: number | null; previous: number | null }[] = []
  let categoryData: { major_category: string; total_amount: number }[] = []
  let totalAmount = 0
  let transactionCount = 0
  let categoryCount = 0
  let deltaPercent: number | null = null

  try {
    const [rawCumulative, rawCategory, rawSummary, rawComparison] = await Promise.all([
      getDailyCumulativeSpending(targetMonth),
      getCategoryBreakdown(targetMonth),
      getMonthSummary(targetMonth),
      getMonthComparison(targetMonth),
    ])

    // Process cumulative data: merge current and previous month into day-indexed array
    const currentMap = new Map<number, number>()
    const prevMap = new Map<number, number>()
    for (const row of rawCumulative) {
      const day = Number(row.day_of_month)
      const cumTotal = Number(row.cumulative_total)
      if (row.month === targetMonth) {
        currentMap.set(day, cumTotal)
      } else {
        prevMap.set(day, cumTotal)
      }
    }
    const maxDay = Math.max(
      ...[...currentMap.keys(), ...prevMap.keys(), 1]
    )
    for (let d = 1; d <= maxDay; d++) {
      cumulativeData.push({
        day: d,
        current: currentMap.get(d) ?? null,
        previous: prevMap.get(d) ?? null,
      })
    }
    // Forward-fill null values for cumulative chart
    let lastCurrent: number | null = null
    let lastPrevious: number | null = null
    for (const item of cumulativeData) {
      if (item.current !== null) lastCurrent = item.current
      else item.current = lastCurrent
      if (item.previous !== null) lastPrevious = item.previous
      else item.previous = lastPrevious
    }

    // Process category data
    categoryData = rawCategory.map((row: AthenaRow) => ({
      major_category: row.major_category || "不明",
      total_amount: Number(row.total_amount || 0),
    }))

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
          <Card>
            <CardHeader>
              <CardTitle>Cumulative Spending</CardTitle>
            </CardHeader>
            <CardContent>
              <CumulativeSpendingChart
                data={cumulativeData}
                currentLabel={formatYearMonth(targetMonth)}
                previousLabel={formatYearMonth(prevMonth)}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Category Breakdown ({formatYearMonth(targetMonth)})</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBreakdownChart data={categoryData} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
