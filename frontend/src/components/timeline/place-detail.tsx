'use client'

import { useMemo, useState } from "react"
import { Bar, BarChart, XAxis, YAxis, Tooltip, Cell } from "recharts"
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart"
import { MapPin, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type RankRow,
  type VisitRow,
  type Bucket,
  type Unit,
  type Metric,
  chartConfig,
  usePlaceVisits,
  WEEKEND,
} from "@/components/timeline/timeline-shared"

type SortKey = keyof VisitRow

export function PlaceDetail({
  name,
  records,
  buckets,
  safePos,
  unit,
  metric,
  onClose,
}: {
  name: string
  records: RankRow[]
  buckets: Bucket[]
  safePos: number
  unit: Unit
  metric: Metric
  onClose?: () => void
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<number>(-1)

  const { visits, loading: isLoadingDetail } = usePlaceVisits(name)

  const metricLabel = metric === "hours" ? "滞在時間(h)" : "回数"
  const curUri = useMemo(() => records.find((r) => r.place_name === name)?.uri, [records, name])

  // サマリはランキング集計(records)から即時に算出（明細取得を待たない）
  const placeStats = useMemo(() => {
    let v = 0
    let h = 0
    for (const r of records) if (r.place_name === name) {
      v += r.visits
      h += r.hours
    }
    return { visits: v, hours: h }
  }, [name, records])

  // 区切りごとの推移（X=粒度, Y=指標）。X軸は初訪問〜最終訪問にトリム
  const series = useMemo(() => {
    const byMon = new Map<string, RankRow>()
    for (const r of records) if (r.place_name === name) byMon.set(r.mon, r)
    const full = buckets.map((b, i) => {
      let hours = 0
      let visits = 0
      for (const m of b.months) {
        const r = byMon.get(m)
        if (r) {
          hours += r.hours
          visits += r.visits
        }
      }
      return { origIdx: i, label: b.short, full: b.label, hours: Number(hours.toFixed(1)), visits }
    })
    const lo = full.findIndex((d) => d.visits > 0)
    if (lo < 0) return full
    let hi = full.length - 1
    while (hi >= 0 && full[hi].visits === 0) hi--
    return full.slice(lo, hi + 1)
  }, [name, records, buckets])

  const sortedVisits = useMemo(() => {
    return [...visits].sort((a, b) => {
      const A = a[sortKey]
      const B = b[sortKey]
      return A < B ? -sortDir : A > B ? sortDir : 0
    })
  }, [visits, sortKey, sortDir])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => -d)
    else {
      setSortKey(k)
      setSortDir(1)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold">
          {name}
          {curUri && (
            <a href={curUri} target="_blank" rel="noreferrer" className="ml-2 text-sm text-primary hover:underline">
              <MapPin className="inline h-3.5 w-3.5" /> Google Maps
            </a>
          )}
        </h3>
        {onClose && (
          <button onClick={onClose} className="rounded-md border bg-muted px-2 py-1 text-xs">
            <X className="inline h-3 w-3" /> 閉じる
          </button>
        )}
      </div>

      <div className="my-3 flex gap-6 text-sm text-muted-foreground">
        <div>
          訪問回数 <b className="text-foreground text-lg tabular-nums">{placeStats.visits}</b> 回
        </div>
        <div>
          合計滞在 <b className="text-foreground text-lg tabular-nums">{placeStats.hours.toFixed(1)}</b> h
        </div>
        <div>
          平均{" "}
          <b className="text-foreground text-lg tabular-nums">
            {placeStats.visits ? Math.round((placeStats.hours * 60) / placeStats.visits) : 0}
          </b>{" "}
          分/回
        </div>
      </div>

      <div className="text-xs text-muted-foreground mb-1">
        期間推移（X={unit === "month" ? "月" : unit === "quarter" ? "四半期" : "年"} / Y={metricLabel}・橙=選択中）
      </div>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart data={series}>
          <XAxis dataKey="label" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
          <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={(v) => (metric === "hours" ? `${v}h` : `${v}回`)}
                labelFormatter={(_value, payload) => payload?.[0]?.payload?.full ?? ""}
              />
            }
          />
          <Bar dataKey={metric} radius={[3, 3, 0, 0]}>
            {series.map((d) => (
              <Cell key={d.origIdx} fill={d.origIdx === safePos ? "var(--chart-4)" : "var(--chart-1)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>

      <div className="text-xs text-muted-foreground mt-4 mb-1">訪問明細</div>
      <div className="max-h-[200px] overflow-auto rounded-md border">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-card">
            <tr className="text-muted-foreground text-left">
              <Th onClick={() => toggleSort("date")}>日付</Th>
              <Th onClick={() => toggleSort("dow")}>曜</Th>
              <Th onClick={() => toggleSort("in")}>入店</Th>
              <Th onClick={() => toggleSort("out")}>退店</Th>
              <Th onClick={() => toggleSort("dur")}>滞在(分)</Th>
            </tr>
          </thead>
          <tbody>
            {isLoadingDetail ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin mr-1" /> 読み込み中…
                </td>
              </tr>
            ) : sortedVisits.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">明細データなし</td>
              </tr>
            ) : (
              sortedVisits.map((v, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1">{v.date}</td>
                  <td className={cn("px-2 py-1", WEEKEND.has(v.dow) && "text-amber-500")}>{v.dow}</td>
                  <td className="px-2 py-1">{v.in}</td>
                  <td className="px-2 py-1">{v.out}</td>
                  <td className="px-2 py-1">{v.dur}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <th onClick={onClick} className="px-2 py-1.5 font-medium cursor-pointer select-none">
      {children}
    </th>
  )
}
