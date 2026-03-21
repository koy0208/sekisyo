import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { StepChart, LowIntensityChart, SleepChart, SleepScheduleChart, HighIntensityChart } from "@/components/dashboard/charts"
import { getSteps, getSleep, getLowIntensity, getActivity, getDataUpdateStatus } from "@/app/actions/athena-actions"
import { Activity, Moon, RefreshCw, Flame, Zap } from "lucide-react"
import Link from "next/link"
import { AthenaRow } from "@/lib/athena"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

type PeriodOption = {
  label: string;
  amount: number;
  unit: string;
  key: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { label: "1 Month", amount: 1, unit: "month", key: "1m" },
  { label: "3 Months", amount: 3, unit: "month", key: "3m" },
  { label: "6 Months", amount: 6, unit: "month", key: "6m" },
  { label: "1 Year", amount: 1, unit: "year", key: "1y" },
  { label: "2 Years", amount: 2, unit: "year", key: "2y" },
]

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const currentKey = (await searchParams).period || "1m"
  const selectedPeriod = PERIOD_OPTIONS.find(p => p.key === currentKey) || PERIOD_OPTIONS[0]

  // Athenaからデータを取得（失敗時は空配列とする）
  let steps: StepData[] = []
  let sleep: SleepData[] = []
  let lowIntensity: LowIntensityData[] = []
  let activity: ActivityData[] = []
  let lastUpdated: string | null = null

  try {
    const [rawSteps, rawSleep, rawLowIntensity, rawActivity, status] = await Promise.all([
      getSteps(selectedPeriod.amount, selectedPeriod.unit),
      getSleep(selectedPeriod.amount, selectedPeriod.unit),
      getLowIntensity(selectedPeriod.amount, selectedPeriod.unit),
      getActivity(selectedPeriod.amount, selectedPeriod.unit),
      getDataUpdateStatus()
    ])

    // 数値変換（Rechartsの表示を安定させるため）
    steps = rawSteps.map((d: AthenaRow) => ({ 
      date: d.date || "", 
      steps: Number(d.steps || 0), 
      steps_ma: d.steps_ma !== undefined ? Number(d.steps_ma) : null 
    }))
    sleep = rawSleep.map((d: AthenaRow) => ({ 
      date: d.date || "", 
      total_sleep_hour: Number(d.total_sleep_hour || 0), 
      total_sleep_hour_ma: d.total_sleep_hour_ma !== undefined ? Number(d.total_sleep_hour_ma) : null,
      start_time: d.start_time || "",
      end_time: d.end_time || ""
    }))
    lowIntensity = rawLowIntensity.map((d: AthenaRow) => ({ 
      date: d.date || "", 
      low_intensity_minutes: Number(d.low_intensity_minutes || 0), 
      low_intensity_ma: d.low_intensity_ma !== undefined ? Number(d.low_intensity_ma) : null 
    }))
    activity = rawActivity.map((d: AthenaRow) => ({ 
      date: d.date || "", 
      active_zone_minutes: Number(d.active_zone_minutes || 0), 
      active_zone_ma: d.active_zone_ma !== undefined ? Number(d.active_zone_ma) : null 
    }))
    lastUpdated = status ?? null
  } catch (error) {
    console.error("Failed to fetch data from Athena:", error)
  }

  const latestSteps = steps.length > 0 ? steps[steps.length - 1].steps : 0
  const latestSleep = sleep.length > 0 ? sleep[sleep.length - 1].total_sleep_hour : 0

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Fitbit Dashboard</h2>
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1 mr-4">
              {PERIOD_OPTIONS.map((opt) => (
                <Link
                  key={opt.key}
                  href={`/?period=${opt.key}`}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    currentKey === opt.key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  {opt.label}
                </Link>
              ))}
            </div>
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4" />
              <span>Last updated: {lastUpdated || "Never"}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Today's Steps"
            value={Number(latestSteps).toLocaleString()}
            unit="steps"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="Sleep Last Night"
            value={Number(latestSleep).toFixed(1)}
            unit="hours"
            icon={<Moon className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="Active Minutes"
            value={activity.length > 0 ? activity[activity.length - 1].active_zone_minutes.toString() : "0"}
            unit="min"
            icon={<Flame className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="Low Intensity"
            value={lowIntensity.length > 0 ? lowIntensity[lowIntensity.length - 1].low_intensity_minutes.toString() : "0"}
            unit="min"
            icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Step Count Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <StepChart data={steps} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sleep Duration (Hours)</CardTitle>
            </CardHeader>
            <CardContent>
              <SleepChart data={sleep} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sleep Schedule (Bedtime & Wake-up)</CardTitle>
            </CardHeader>
            <CardContent>
              <SleepScheduleChart data={sleep} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>High Intensity (Active Zone Minutes)</CardTitle>
            </CardHeader>
            <CardContent>
              <HighIntensityChart data={activity} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Low Intensity Minutes</CardTitle>
            </CardHeader>
            <CardContent>
              <LowIntensityChart data={lowIntensity} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
