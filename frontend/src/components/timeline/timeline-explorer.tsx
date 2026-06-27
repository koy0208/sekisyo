'use client'

import { useMemo, useState } from "react"
import { Bar, BarChart, XAxis, YAxis, Tooltip, Cell } from "recharts"
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MapPin, X, ChevronRight, ChevronLeft, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { getTimelinePlaceVisits } from "@/app/actions/timeline-actions"
import { AthenaRow } from "@/lib/athena"

export type RankRow = { mon: string; place_name: string; uri?: string; visits: number; hours: number }
export type VisitRow = { date: string; dow: string; in: string; out: string; dur: number }

type Unit = "month" | "quarter" | "year"
type Metric = "hours" | "visits"
type SortKey = keyof VisitRow

const UNIT_OPTIONS: { key: Unit; label: string }[] = [
  { key: "month", label: "月" },
  { key: "quarter", label: "3ヶ月" },
  { key: "year", label: "1年" },
]
const METRIC_OPTIONS: { key: Metric; label: string }[] = [
  { key: "hours", label: "滞在時間" },
  { key: "visits", label: "回数" },
]
const WEEKEND = new Set(["Sat", "Sun"])

type Bucket = { label: string; short: string; months: string[] }

function buildBuckets(months: string[], unit: Unit): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const m of months) {
    const [y, mm] = m.split("-")
    let key: string, label: string, short: string
    if (unit === "month") {
      key = m
      label = m
      short = m.slice(2)
    } else if (unit === "quarter") {
      const q = Math.floor((Number(mm) - 1) / 3) + 1
      key = `${y}-Q${q}`
      label = `${y} Q${q} (${(q - 1) * 3 + 1}-${q * 3}月)`
      short = `${y.slice(2)}Q${q}`
    } else {
      key = y
      label = `${y}年`
      short = y
    }
    if (!map.has(key)) map.set(key, { label, short, months: [] })
    map.get(key)!.months.push(m)
  }
  return Array.from(map.values())
}

const chartConfig = {
  hours: { label: "滞在時間(h)", color: "var(--chart-1)" },
  visits: { label: "回数", color: "var(--chart-1)" },
} satisfies ChartConfig

export function TimelineExplorer({ records }: { records: RankRow[] }) {
  const [unit, setUnit] = useState<Unit>("month")
  const [metric, setMetric] = useState<Metric>("hours")
  const [pos, setPos] = useState<number>(Number.MAX_SAFE_INTEGER)
  const [curName, setCurName] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<number>(-1)
  // 訪問明細はクリック時に都度取得し、取得済みはキャッシュ
  const [detailCache, setDetailCache] = useState<Record<string, VisitRow[]>>({})
  const [loadingName, setLoadingName] = useState<string | null>(null)

  async function selectPlace(name: string) {
    setCurName(name)
    if (detailCache[name]) return
    setLoadingName(name)
    try {
      const rows = (await getTimelinePlaceVisits(name)) as AthenaRow[]
      const mapped: VisitRow[] = rows.map((r) => ({
        date: r.date || "",
        dow: r.dow || "",
        in: r.in_t || "",
        out: r.out_t || "",
        dur: Number(r.dur || 0),
      }))
      setDetailCache((c) => ({ ...c, [name]: mapped }))
    } catch (e) {
      console.error("Failed to fetch visit detail:", e)
      setDetailCache((c) => ({ ...c, [name]: [] }))
    } finally {
      setLoadingName(null)
    }
  }

  const months = useMemo(
    () => Array.from(new Set(records.map((r) => r.mon))).sort(),
    [records]
  )
  const buckets = useMemo(() => buildBuckets(months, unit), [months, unit])
  const safePos = Math.max(0, Math.min(pos, buckets.length - 1))
  const current = buckets[safePos]

  function changeUnit(u: Unit) {
    const next = buildBuckets(months, u)
    setUnit(u)
    setPos(next.length - 1)
  }

  // 選択中の区切りの場所ランキング（全件・指標で降順）
  const items = useMemo(() => {
    if (!current) return []
    const set = new Set(current.months)
    const agg = new Map<string, { name: string; uri?: string; visits: number; hours: number }>()
    for (const r of records) {
      if (!set.has(r.mon)) continue
      const a = agg.get(r.place_name) ?? { name: r.place_name, uri: r.uri, visits: 0, hours: 0 }
      a.visits += r.visits
      a.hours += r.hours
      agg.set(r.place_name, a)
    }
    return Array.from(agg.values()).sort((x, y) =>
      metric === "hours" ? y.hours - x.hours : y.visits - x.visits
    )
  }, [records, current, metric])

  const maxVal = Math.max(...items.map((i) => (metric === "hours" ? i.hours : i.visits)), 1)

  // ドリルダウン: 選択場所の区切りごと推移（X=粒度, Y=指標）。X軸は初訪問〜最終訪問にトリム
  const series = useMemo(() => {
    if (!curName) return [] as { origIdx: number; label: string; full: string; hours: number; visits: number }[]
    const byMon = new Map<string, RankRow>()
    for (const r of records) if (r.place_name === curName) byMon.set(r.mon, r)
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
  }, [curName, records, buckets])

  const visits = useMemo(() => (curName ? detailCache[curName] ?? [] : []), [curName, detailCache])
  const isLoadingDetail = loadingName === curName
  // サマリはランキング集計(records)から即時に算出（明細取得を待たない）
  const placeStats = useMemo(() => {
    if (!curName) return { visits: 0, hours: 0 }
    let v = 0
    let h = 0
    for (const r of records) if (r.place_name === curName) {
      v += r.visits
      h += r.hours
    }
    return { visits: v, hours: h }
  }, [curName, records])
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

  const curUri = curName ? records.find((r) => r.place_name === curName)?.uri : undefined
  const metricLabel = metric === "hours" ? "滞在時間(h)" : "回数"

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 flex-wrap">
        <CardTitle className="text-xl font-bold tabular-nums">{current?.label ?? "-"}</CardTitle>
        <div className="flex gap-2">
          <Toggle options={UNIT_OPTIONS} value={unit} onChange={changeUnit} />
          <Toggle options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
        </div>
      </CardHeader>
      <CardContent>
        {/* 期間ナビ */}
        <div className="flex items-center gap-3">
          <button
            className="h-8 w-8 rounded-md border bg-muted disabled:opacity-30"
            disabled={safePos <= 0}
            onClick={() => setPos(safePos - 1)}
            aria-label="前の期間"
          >
            <ChevronLeft className="h-4 w-4 mx-auto" />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, buckets.length - 1)}
            value={safePos}
            onChange={(e) => setPos(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <button
            className="h-8 w-8 rounded-md border bg-muted disabled:opacity-30"
            disabled={safePos >= buckets.length - 1}
            onClick={() => setPos(safePos + 1)}
            aria-label="次の期間"
          >
            <ChevronRight className="h-4 w-4 mx-auto" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-6 lg:flex-row">
          {/* 左: ランキング（スクロール・全件） */}
          <div className="lg:w-1/2 min-w-0">
            <div className="max-h-[540px] overflow-y-auto pr-2 space-y-2">
              {items.map((it, i) => {
                const v = metric === "hours" ? it.hours : it.visits
                const w = (v / maxVal) * 100
                const selected = it.name === curName
                return (
                  <div
                    key={it.name}
                    onClick={() => selectPlace(it.name)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-1.5 py-1 cursor-pointer hover:bg-muted",
                      selected && "bg-muted outline outline-1 outline-primary"
                    )}
                  >
                    <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-sm mb-0.5">
                        <span className="truncate">
                          {it.uri ? (
                            <a
                              href={it.uri}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="hover:underline"
                            >
                              {it.name}
                              <MapPin className="inline h-3 w-3 ml-0.5 opacity-60" />
                            </a>
                          ) : (
                            it.name
                          )}
                        </span>
                        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                          {it.hours.toFixed(1)}h / {it.visits}回
                          <ChevronRight className="inline h-3 w-3 text-muted-foreground/60" />
                        </span>
                      </div>
                      <div className="h-3.5 rounded bg-primary transition-all" style={{ width: `${w}%`, minWidth: 2 }} />
                    </div>
                  </div>
                )
              })}
              {items.length === 0 && (
                <div className="py-10 text-center text-sm text-muted-foreground">この期間のデータがありません</div>
              )}
            </div>
          </div>

          {/* 右: ドリルダウン */}
          <div className="lg:w-1/2 min-w-0 lg:border-l lg:pl-6">
            {!curName ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                ← ランキングの行をクリックすると、ここに詳細が表示されます
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">
                    {curName}
                    {curUri && (
                      <a href={curUri} target="_blank" rel="noreferrer" className="ml-2 text-sm text-primary hover:underline">
                        <MapPin className="inline h-3.5 w-3.5" /> Google Maps
                      </a>
                    )}
                  </h3>
                  <button
                    onClick={() => setCurName(null)}
                    className="rounded-md border bg-muted px-2 py-1 text-xs"
                  >
                    <X className="inline h-3 w-3" /> 閉じる
                  </button>
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
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-3 py-1 text-xs transition-colors",
            value === o.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
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
