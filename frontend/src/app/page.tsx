import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { DataError } from "@/components/shared/data-error"
import { fetchMart } from "@/lib/marts"
import { type DailyRow, type MartMeta } from "@/lib/mart-types"
import { settle, shortDate, weekStart } from "@/lib/utils"
import { GOALS } from "@/config/goals"
import { Activity, Moon, Wallet, MapPin, Flame, RefreshCw } from "lucide-react"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

// 統合ホーム (docs/redesign/03-ui-unification.md 3e)。
// 「今日/今週の自分」を 1 画面にし、各ページはここからのドリルダウン先にする。
// marts/daily.json + marts/meta.json の 2 fetch で全部賄う。

type NumericKey = 'steps' | 'sleep_hours' | 'active_zone_min' | 'low_intensity_min'

// 指標ごとの最新値 (値が存在する最後の日)
function latestOf(rows: DailyRow[], key: NumericKey): { date: string; val: number } | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const val = rows[i][key]
    if (val != null) return { date: rows[i].date, val }
  }
  return undefined
}

function todayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// "2026-07-04" → "7/4 (土)"
function dateWithDow(isoDate: string): string {
  const dow = new Date(`${isoDate}T12:00:00`).toLocaleDateString("ja-JP", { weekday: "short" })
  return `${shortDate(isoDate)} (${dow})`
}

// 直近 7 日テーブルの横棒。週内の最大値に対する割合で幅を決める
function MetricBar({ value, max, label }: { value: number | null; max: number; label: string }) {
  if (value == null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const pct = max > 0 ? Math.max((value / max) * 100, 4) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-muted md:w-24">
        <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums whitespace-nowrap">{label}</span>
    </div>
  )
}

export default async function HomePage() {
  const [daily, meta] = await Promise.all([
    settle(fetchMart<DailyRow[]>("daily.json"), "daily mart"),
    settle(fetchMart<MartMeta>("meta.json"), "mart meta"),
  ])

  const today = todayIso()
  const currentMonth = today.slice(0, 7)
  const thisWeekStart = weekStart(today)

  const latestSleep = daily ? latestOf(daily, "sleep_hours") : undefined
  const latestSteps = daily ? latestOf(daily, "steps") : undefined

  // 今月の支出 (支出は Money Forward 由来の負値のまま扱う。家計ページと同じ表記)
  const monthSpending = (daily ?? [])
    .filter((r) => r.date.startsWith(currentMonth))
    .reduce((sum, r) => sum + (r.spending_total ?? 0), 0)

  // 今週 (月曜始まり) の外出・運動
  const weekRows = (daily ?? []).filter((r) => r.date >= thisWeekStart && r.date <= today)
  const weekVisits = weekRows.reduce((sum, r) => sum + (r.visit_count ?? 0), 0)
  const weekOutHours = weekRows.reduce((sum, r) => sum + (r.out_hours ?? 0), 0)
  const weekActiveMin = weekRows.reduce((sum, r) => sum + (r.active_zone_min ?? 0), 0)

  // 直近 7 日 (新しい日が上)
  const recent = (daily ?? []).slice(-7).reverse()
  const maxSleep = Math.max(...recent.map((r) => r.sleep_hours ?? 0), 0)
  const maxSteps = Math.max(...recent.map((r) => r.steps ?? 0), 0)

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">ホーム</h2>

        {!daily && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            データの取得に失敗しました。時間をおいて再読み込みしてください。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="睡眠"
            asOf={latestSleep ? shortDate(latestSleep.date) : undefined}
            value={latestSleep ? latestSleep.val.toFixed(1) : "—"}
            unit="時間"
            icon={<Moon className="h-4 w-4 text-muted-foreground" />}
            progress={latestSleep ? { current: Number(latestSleep.val.toFixed(1)), target: GOALS.sleep_hours_min } : undefined}
          />
          <StatsCard
            title="歩数"
            asOf={latestSteps ? shortDate(latestSteps.date) : undefined}
            value={latestSteps ? latestSteps.val.toLocaleString() : "—"}
            unit="歩"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            progress={latestSteps ? { current: latestSteps.val, target: GOALS.steps_per_day } : undefined}
          />
          <StatsCard
            title="今週の運動"
            value={daily ? weekActiveMin : "—"}
            unit="分"
            icon={<Flame className="h-4 w-4 text-muted-foreground" />}
            progress={daily ? { current: weekActiveMin, target: GOALS.active_zone_min_per_week } : undefined}
          />
          <StatsCard
            title="今週の外出"
            value={daily ? weekVisits : "—"}
            unit="回"
            description={daily ? `計 ${weekOutHours.toFixed(1)} 時間` : undefined}
            icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="今月の支出"
            value={daily ? `¥${monthSpending.toLocaleString()}` : "—"}
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
            progress={daily ? { current: Math.abs(monthSpending), target: GOALS.budget_per_month, lowerIsBetter: true } : undefined}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>直近 7 日</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <DataError />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">日付</th>
                      <th className="py-2 pr-4 font-medium">睡眠</th>
                      <th className="py-2 pr-4 font-medium">歩数</th>
                      <th className="py-2 pr-4 font-medium text-right">支出</th>
                      <th className="py-2 font-medium">主な訪問先</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.date} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 whitespace-nowrap tabular-nums">
                          <Link href={`/day/${r.date}`} className="text-primary hover:underline">
                            {dateWithDow(r.date)}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-4">
                          <MetricBar
                            value={r.sleep_hours}
                            max={maxSleep}
                            label={r.sleep_hours != null ? `${r.sleep_hours.toFixed(1)}h` : ""}
                          />
                        </td>
                        <td className="py-2.5 pr-4">
                          <MetricBar
                            value={r.steps}
                            max={maxSteps}
                            label={r.steps != null ? r.steps.toLocaleString() : ""}
                          />
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums whitespace-nowrap">
                          {r.spending_total != null ? `¥${r.spending_total.toLocaleString()}` : "—"}
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          {r.top_places?.length
                            ? r.top_places.slice(0, 2).map((p) => p.name).join("・")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {meta && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              データ更新:
            </span>
            <span>Fitbit {meta.sources.fitbit.last_date ? shortDate(meta.sources.fitbit.last_date) : "不明"}</span>
            <span>家計簿 {meta.sources.budget.last_date ? shortDate(meta.sources.budget.last_date) : "不明"}</span>
            <span>位置情報 {meta.sources.timeline.last_date ? shortDate(meta.sources.timeline.last_date) : "不明"}</span>
          </div>
        )}
      </div>
    </div>
  )
}
