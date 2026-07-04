import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { StepChart, LowIntensityChart, SleepChart, SleepScheduleChart, HighIntensityChart } from "@/components/dashboard/charts"
import { PeriodSelector } from "@/components/shared/period-selector"
import { DataError } from "@/components/shared/data-error"
import { getSteps, getSleep, getLowIntensity, getActivity, getLatestStats } from "@/app/actions/athena-actions"
import { resolvePeriod, periodToInterval } from "@/lib/period"
import { Activity, Moon, RefreshCw, Flame, Zap } from "lucide-react"
import { AthenaRow } from "@/lib/athena"
import { settle, shortDate } from "@/lib/utils"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

interface BaseData {
  date: string;
}

type StepData = BaseData & { steps: number; steps_ma: number | null };
type SleepData = BaseData & {
  total_sleep_hour: number;
  total_sleep_hour_ma: number | null;
  start_time: string;
  end_time: string;
};
type LowIntensityData = BaseData & { low_intensity_minutes: number; low_intensity_ma: number | null };
type ActivityData = BaseData & { active_zone_minutes: number; active_zone_ma: number | null };

type LatestStat = { date: string; val: number }

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const period = resolvePeriod((await searchParams).period)
  const interval = periodToInterval(period)
  const amount = interval?.amount ?? 0
  const unit = interval?.unit ?? 'all'

  const [rawSteps, rawSleep, rawLowIntensity, rawActivity, rawLatest] = await Promise.all([
    settle(getSteps(amount, unit), "steps"),
    settle(getSleep(amount, unit), "sleep"),
    settle(getLowIntensity(amount, unit), "low intensity"),
    settle(getActivity(amount, unit), "activity"),
    settle(getLatestStats(), "latest stats"),
  ])

  const steps: StepData[] | null = rawSteps?.map((d: AthenaRow) => ({
    date: d.date || "",
    steps: Number(d.steps || 0),
    steps_ma: d.steps_ma !== undefined ? Number(d.steps_ma) : null
  })) ?? null
  const sleep: SleepData[] | null = rawSleep?.map((d: AthenaRow) => ({
    date: d.date || "",
    total_sleep_hour: Number(d.total_sleep_hour || 0),
    total_sleep_hour_ma: d.total_sleep_hour_ma !== undefined ? Number(d.total_sleep_hour_ma) : null,
    start_time: d.start_time || "",
    end_time: d.end_time || ""
  })) ?? null
  const lowIntensity: LowIntensityData[] | null = rawLowIntensity?.map((d: AthenaRow) => ({
    date: d.date || "",
    low_intensity_minutes: Number(d.low_intensity_minutes || 0),
    low_intensity_ma: d.low_intensity_ma !== undefined ? Number(d.low_intensity_ma) : null
  })) ?? null
  const activity: ActivityData[] | null = rawActivity?.map((d: AthenaRow) => ({
    date: d.date || "",
    active_zone_minutes: Number(d.active_zone_minutes || 0),
    active_zone_ma: d.active_zone_ma !== undefined ? Number(d.active_zone_ma) : null
  })) ?? null

  // 各指標の最新値(選択期間と独立)。metric 名 → {date, val}
  const latest = new Map<string, LatestStat>()
  for (const row of rawLatest ?? []) {
    if (row.metric && row.date) {
      latest.set(row.metric, { date: row.date, val: Number(row.val || 0) })
    }
  }
  const latestSteps = latest.get("steps")
  const latestSleep = latest.get("sleep")
  const latestActive = latest.get("active_zone")
  const latestLow = latest.get("low_intensity")
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
