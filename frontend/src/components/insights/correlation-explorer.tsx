'use client'

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { Toggle } from "@/components/timeline/timeline-shared"
import { shortDate } from "@/lib/utils"

// 相関ビューに渡す 1 日分 (サーバ側で daily マートから必要列に絞る)
export type CorrelationPoint = {
  date: string
  steps: number | null
  sleep_hours: number | null
  active_zone_min: number | null
  low_intensity_min: number | null
  spending: number | null // 支出額 (正値)
  out_hours: number | null
  visit_count: number | null
  tags: string[]
}

type MetricKey = Exclude<keyof CorrelationPoint, 'date' | 'tags'>

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "steps", label: "歩数" },
  { key: "sleep_hours", label: "睡眠時間" },
  { key: "active_zone_min", label: "高強度(分)" },
  { key: "low_intensity_min", label: "低強度(分)" },
  { key: "spending", label: "支出額" },
  { key: "out_hours", label: "外出時間" },
  { key: "visit_count", label: "訪問数" },
]

const LAG_OPTIONS: { key: "0" | "1"; label: string }[] = [
  { key: "0", label: "同じ日" },
  { key: "1", label: "X は前日" },
]

const label = (key: MetricKey) => METRICS.find((m) => m.key === key)!.label

function pearson(pairs: { x: number; y: number }[]): number | null {
  const n = pairs.length
  if (n < 3) return null
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n
  const my = pairs.reduce((s, p) => s + p.y, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (const p of pairs) {
    sxy += (p.x - mx) * (p.y - my)
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

function Select({ value, onChange, exclude }: {
  value: MetricKey
  onChange: (v: MetricKey) => void
  exclude?: MetricKey
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MetricKey)}
      className="h-9 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {METRICS.filter((m) => m.key !== exclude).map((m) => (
        <option key={m.key} value={m.key}>{m.label}</option>
      ))}
    </select>
  )
}

const chartConfig = { y: { label: "Y", color: "var(--chart-1)" } } satisfies ChartConfig

export function CorrelationExplorer({ data }: { data: CorrelationPoint[] }) {
  const [xKey, setXKey] = useState<MetricKey>("steps")
  const [yKey, setYKey] = useState<MetricKey>("sleep_hours")
  const [lag, setLag] = useState<"0" | "1">("0")

  const points = useMemo(() => {
    const byDate = new Map(data.map((r) => [r.date, r]))
    const result: { x: number; y: number; date: string }[] = []
    for (const row of data) {
      // ラグ指定時は前日の X と当日の Y を組にする (「運動した翌日はよく眠れるか」)
      const xRow = lag === "1" ? byDate.get(prevDate(row.date)) : row
      const x = xRow?.[xKey]
      const y = row[yKey]
      if (x != null && y != null) result.push({ x, y, date: row.date })
    }
    return result
  }, [data, xKey, yKey, lag])

  const r = useMemo(() => pearson(points), [points])

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>散布図</CardTitle>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            X: <Select value={xKey} onChange={setXKey} />
          </span>
          <span className="flex items-center gap-2">
            Y: <Select value={yKey} onChange={setYKey} />
          </span>
          <Toggle options={LAG_OPTIONS} value={lag} onChange={setLag} />
        </div>
        <p className="text-xs text-muted-foreground">
          {points.length} 日分・相関係数 r = {r != null ? r.toFixed(2) : "—"}
          {lag === "1" && `(前日の${label(xKey)} × 当日の${label(yKey)})`}
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[400px] w-full">
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="x"
              name={label(xKey)}
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={label(yKey)}
              stroke="#888888"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as { x: number; y: number; date: string } | undefined
                if (!p) return null
                return (
                  <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                    <div className="font-medium">{shortDate(p.date)}</div>
                    <div>{label(xKey)}: {p.x.toLocaleString()}</div>
                    <div>{label(yKey)}: {p.y.toLocaleString()}</div>
                  </div>
                )
              }}
            />
            <Scatter data={points} fill="var(--chart-1)" fillOpacity={0.55} />
          </ScatterChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function prevDate(d: string): string {
  const t = new Date(`${d}T12:00:00`)
  t.setDate(t.getDate() - 1)
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, "0")
  const dd = String(t.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

// 場所タグ対比: タグの場所に行った日 / 行かない日の平均を比較する
export function TagComparison({ data }: { data: CorrelationPoint[] }) {
  const tags = useMemo(() => Array.from(new Set(data.flatMap((r) => r.tags))).sort(), [data])

  if (tags.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>場所タグとの対比</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            config/place-tags.ts に place_id → タグのマッピングを追加すると、
            「その場所に行った日 / 行かない日」で指標の平均を比較できます。
          </p>
        </CardContent>
      </Card>
    )
  }

  const compareMetrics: MetricKey[] = ["sleep_hours", "steps", "active_zone_min", "spending"]
  const avg = (rows: CorrelationPoint[], key: MetricKey) => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }
  const fmt = (v: number | null) => (v == null ? "—" : Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1))

  return (
    <Card>
      <CardHeader>
        <CardTitle>場所タグとの対比(1 日平均)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {tags.map((tag) => {
          const withTag = data.filter((r) => r.tags.includes(tag))
          const withoutTag = data.filter((r) => !r.tags.includes(tag))
          return (
            <div key={tag}>
              <h4 className="mb-2 text-sm font-medium">
                {tag} <span className="font-normal text-muted-foreground">(行った日 {withTag.length} 日)</span>
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-4 font-medium"></th>
                      {compareMetrics.map((k) => (
                        <th key={k} className="py-1.5 pr-4 font-medium text-right">{label(k)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: "行った日", rows: withTag },
                      { name: "行かない日", rows: withoutTag },
                    ].map(({ name, rows }) => (
                      <tr key={name} className="border-b last:border-0">
                        <td className="py-1.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">{name}</td>
                        {compareMetrics.map((k) => (
                          <td key={k} className="py-1.5 pr-4 text-right tabular-nums">{fmt(avg(rows, k))}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
