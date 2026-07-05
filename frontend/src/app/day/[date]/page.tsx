import Link from "next/link"
import { notFound } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatsCard } from "@/components/dashboard/stats-card"
import { DataError } from "@/components/shared/data-error"
import { DayTimeline } from "@/components/timeline/day-timeline"
import { mapDayEvents } from "@/components/timeline/day-utils"
import { fetchMart, fetchMartOrNull } from "@/lib/marts"
import {
  type BudgetTransactionRow,
  type DailyRow,
  type TimelineDayEventRow,
} from "@/lib/mart-types"
import { settle, shiftDate } from "@/lib/utils"
import { Activity, Moon, Flame, Wallet, ChevronLeft, ChevronRight } from "lucide-react"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

// デイビュー (docs/redesign/04-cross-features.md 4a)。
// 「この日どこへ行き、いくら使い、どう眠ったか」を 1 画面で見る。

// "2026-07-04" → "2026年7月4日 (土)"
function longDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
}

function NavButton({ href, disabled, dir }: { href: string; disabled: boolean; dir: "prev" | "next" }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight
  const label = dir === "prev" ? "前の日" : "次の日"
  if (disabled) {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted opacity-30">
        <Icon className="h-4 w-4" />
      </span>
    )
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted transition-colors hover:bg-muted/70"
    >
      <Icon className="h-4 w-4" />
    </Link>
  )
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const [dailyMart, events, transactions] = await Promise.all([
    settle(fetchMart<DailyRow[]>("daily.json"), "daily mart"),
    settle(fetchMartOrNull<TimelineDayEventRow[]>(`timeline_days/${date}.json`), "timeline day"),
    settle(fetchMartOrNull<BudgetTransactionRow[]>(`budget_transactions/${date.slice(0, 7)}.json`), "budget transactions"),
  ])

  const day = dailyMart?.find((r) => r.date === date)
  // 日付ナビの範囲はデータが存在する最初と最後の日
  const minDate = dailyMart?.[0]?.date
  const maxDate = dailyMart?.[dailyMart.length - 1]?.date

  const dayTx = (transactions ?? []).filter((t) => t.date === date)

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{longDate(date)}</h2>
          <div className="flex items-center gap-2">
            <NavButton href={`/day/${shiftDate(date, -1)}`} disabled={!!minDate && date <= minDate} dir="prev" />
            <NavButton href={`/day/${shiftDate(date, 1)}`} disabled={!!maxDate && date >= maxDate} dir="next" />
          </div>
        </div>

        {!dailyMart && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            データの取得に失敗しました。時間をおいて再読み込みしてください。
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="睡眠"
            value={day?.sleep_hours != null ? day.sleep_hours.toFixed(1) : "—"}
            unit="時間"
            description={day?.sleep_start && day?.sleep_end ? `${day.sleep_start} – ${day.sleep_end}` : undefined}
            icon={<Moon className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="歩数"
            value={day?.steps != null ? day.steps.toLocaleString() : "—"}
            unit="歩"
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="高強度運動"
            value={day?.active_zone_min != null ? day.active_zone_min : "—"}
            unit="分"
            icon={<Flame className="h-4 w-4 text-muted-foreground" />}
          />
          <StatsCard
            title="支出"
            value={day?.spending_total != null ? `¥${day.spending_total.toLocaleString()}` : "—"}
            icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>この日の移動</CardTitle>
          </CardHeader>
          <CardContent>
            {events === null && !dailyMart ? (
              <DataError />
            ) : (
              <DayTimeline events={mapDayEvents(events ?? [])} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>この日の支出明細</CardTitle>
          </CardHeader>
          <CardContent>
            {dayTx.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">この日の取引はありません</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">カテゴリ</th>
                      <th className="py-2 pr-4 font-medium">内容</th>
                      <th className="py-2 font-medium text-right">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayTx.map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2.5 pr-4 whitespace-nowrap text-xs text-muted-foreground">
                          {t.major_category}
                          {t.sub_category !== "不明" && ` / ${t.sub_category}`}
                        </td>
                        <td className="py-2.5 pr-4">{t.description || "—"}</td>
                        <td className="py-2.5 text-right tabular-nums whitespace-nowrap">
                          ¥{t.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
