'use client'

import { useEffect, useState } from "react"
import { type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { getTimelinePlaceVisits } from "@/app/actions/timeline-actions"
import { AthenaRow } from "@/lib/athena"

// 月 × 場所のランキング 1 行（マップ用に place_id / lat / lng を保持）
export type RankRow = {
  mon: string
  placeId: string
  place_name: string
  uri?: string
  lat: number | null
  lng: number | null
  visits: number
  hours: number
}

export type VisitRow = { date: string; dow: string; in: string; out: string; dur: number }

// 期間内に集約した場所（ランキング・マップ共通）
export type PlaceItem = {
  name: string
  placeId: string
  uri?: string
  lat: number | null
  lng: number | null
  visits: number
  hours: number
}

export type Unit = "month" | "quarter" | "year"
export type Metric = "hours" | "visits"

export const UNIT_OPTIONS: { key: Unit; label: string }[] = [
  { key: "month", label: "月" },
  { key: "quarter", label: "3ヶ月" },
  { key: "year", label: "1年" },
]
export const METRIC_OPTIONS: { key: Metric; label: string }[] = [
  { key: "hours", label: "滞在時間" },
  { key: "visits", label: "回数" },
]
export const WEEKEND = new Set(["Sat", "Sun"])

export type Bucket = { label: string; short: string; months: string[] }

export function buildBuckets(months: string[], unit: Unit): Bucket[] {
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

export const chartConfig = {
  hours: { label: "滞在時間(h)", color: "var(--chart-1)" },
  visits: { label: "回数", color: "var(--chart-1)" },
} satisfies ChartConfig

// 訪問明細のモジュールレベルキャッシュ。ランキング/マップ両タブで共有し、
// 同じ場所を両タブで開いても再取得しない。キーは place_id（集計と同じ単位）。
const visitsCache = new Map<string, VisitRow[]>()

export function usePlaceVisits(placeId: string | null): { visits: VisitRow[]; loading: boolean } {
  const [, force] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!placeId || visitsCache.has(placeId)) return
    let active = true
    setLoading(true)
    getTimelinePlaceVisits(placeId)
      .then((rows) => {
        const mapped: VisitRow[] = (rows as AthenaRow[]).map((r) => ({
          date: r.date || "",
          dow: r.dow || "",
          in: r.in_t || "",
          out: r.out_t || "",
          dur: Number(r.dur || 0),
        }))
        visitsCache.set(placeId, mapped)
      })
      .catch((e) => {
        console.error("Failed to fetch visit detail:", e)
        visitsCache.set(placeId, [])
      })
      .finally(() => {
        if (active) {
          setLoading(false)
          force((n) => n + 1)
        }
      })
    return () => {
      active = false
    }
  }, [placeId])

  const visits = placeId ? visitsCache.get(placeId) ?? [] : []
  const loadingNow = !!placeId && !visitsCache.has(placeId) && loading
  return { visits, loading: loadingNow }
}

export function Toggle<T extends string>({
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
