import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { StepChart, LowIntensityChart, SleepChart, SleepScheduleChart, HighIntensityChart } from "@/components/dashboard/charts"
import { PeriodSelector } from "@/components/shared/period-selector"
import { DataError } from "@/components/shared/data-error"
import { fetchMart } from "@/lib/marts"
import { type ActivityDailyRow, type ActivityMonthlyRow } from "@/lib/mart-types"
import { resolvePeriod, periodCutoff } from "@/lib/period"
import { Activity, Moon, RefreshCw, Flame, Zap } from "lucide-react"
import { settle, shortDate } from "@/lib/utils"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

type LatestStat = { date: string; val: number }

// 指標ごとの最新値 (選択期間と独立)。値が存在する最後の日を採用する
function latestOf(
  rows: ActivityDailyRow[],
  key: 'steps' | 'sleep_hours' | 'active_zone_min' | 'low_intensity_min'
): LatestStat | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const val = rows[i][key]
    if (val != null) return { date: rows[i].date, val }
  }
  return undefined
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const period = resolvePeriod((await searchParams).period)
  const cutoff = periodCutoff(period)
  const isAll = period.months == null

  const [dailyMart, monthlyMart] = await Promise.all([
    settle(fetchMart<ActivityDailyRow[]>("activity_daily.json"), "activity daily mart"),
    isAll
      ? settle(fetchMart<ActivityMonthlyRow[]>("activity_monthly.json"), "activity monthly mart")
      : Promise.resolve(null),
  ])

  // 期間内かつ指標が存在する日のみ (旧クエリは指標ごとの GROUP BY で欠測日を返さなかった)
  const inPeriod = dailyMart?.filter((d) => cutoff == null || d.date >= cutoff) ?? null

  const steps = isAll
    ? monthlyMart
        ?.filter((d) => d.steps != null)
        .map((d) => ({ date: d.month, steps: d.steps!, steps_ma: null })) ?? null
    : inPeriod
        ?.filter((d) => d.steps != null)
        .map((d) => ({ date: d.date, steps: d.steps!, steps_ma: d.steps_ma })) ?? null

  const sleep = isAll
    ? monthlyMart
        ?.filter((d) => d.sleep_hours != null)
        .map((d) => ({
          date: d.month,
          total_sleep_hour: d.sleep_hours!,
          total_sleep_hour_ma: null,
          sleep_start: null,
          sleep_end: null,
        })) ?? null
    : inPeriod
        ?.filter((d) => d.sleep_hours != null)
        .map((d) => ({
          date: d.date,
          total_sleep_hour: d.sleep_hours!,
          total_sleep_hour_ma: d.sleep_hours_ma,
          sleep_start: d.sleep_start,
          sleep_end: d.sleep_end,
        })) ?? null

  const activity = isAll
    ? monthlyMart
        ?.filter((d) => d.active_zone_min != null)
        .map((d) => ({ date: d.month, active_zone_minutes: d.active_zone_min!, active_zone_ma: null })) ?? null
    : inPeriod
        ?.filter((d) => d.active_zone_min != null)
        .map((d) => ({ date: d.date, active_zone_minutes: d.active_zone_min!, active_zone_ma: d.active_zone_ma })) ?? null

  const lowIntensity = isAll
    ? monthlyMart
        ?.filter((d) => d.low_intensity_min != null)
        .map((d) => ({ date: d.month, low_intensity_minutes: d.low_intensity_min!, low_intensity_ma: null })) ?? null
    : inPeriod
        ?.filter((d) => d.low_intensity_min != null)
        .map((d) => ({ date: d.date, low_intensity_minutes: d.low_intensity_min!, low_intensity_ma: d.low_intensity_ma })) ?? null

  const latestSteps = dailyMart ? latestOf(dailyMart, "steps") : undefined
  const latestSleep = dailyMart ? latestOf(dailyMart, "sleep_hours") : undefined
  const latestActive = dailyMart ? latestOf(dailyMart, "active_zone_min") : undefined
  const latestLow = dailyMart ? latestOf(dailyMart, "low_intensity_min") : undefined
  const allFailed = steps === null && sleep === null && lowIntensity === null && activity === null

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">アクティビティ</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PeriodSelector basePath="/activity" currentKey={period.key} />
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4" />
              <span>データ更新: {latestSteps?.date ?? "不明"}</span>
            </div>
          </div>
        </div>

        {allFailed && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            データの取得に失敗しました。時間をおいて再読み込みしてください。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="歩数"
            asOf={latestSteps ? shortDate(latestSteps.date) : undefined}
            value={latestSteps ? latestSteps.val.toLocaleString() : "—"}
            unit="歩"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="睡眠"
            asOf={latestSleep ? shortDate(latestSleep.date) : undefined}
            value={latestSleep ? latestSleep.val.toFixed(1) : "—"}
            unit="時間"
            icon={<Moon className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="高強度"
            asOf={latestActive ? shortDate(latestActive.date) : undefined}
            value={latestActive ? latestActive.val.toString() : "—"}
            unit="分"
            icon={<Flame className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="低強度"
            asOf={latestLow ? shortDate(latestLow.date) : undefined}
            value={latestLow ? latestLow.val.toString() : "—"}
            unit="分"
            icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>歩数の推移</CardTitle>
            </CardHeader>
            <CardContent>
              {steps ? <StepChart data={steps} /> : <DataError />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>睡眠時間</CardTitle>
            </CardHeader>
            <CardContent>
              {sleep ? <SleepChart data={sleep} /> : <DataError />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>就寝・起床時刻</CardTitle>
            </CardHeader>
            <CardContent>
              {sleep ? <SleepScheduleChart data={sleep} /> : <DataError />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>高強度運動(アクティブゾーン)</CardTitle>
            </CardHeader>
            <CardContent>
              {activity ? <HighIntensityChart data={activity} /> : <DataError />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>低強度運動</CardTitle>
            </CardHeader>
            <CardContent>
              {lowIntensity ? <LowIntensityChart data={lowIntensity} /> : <DataError />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
