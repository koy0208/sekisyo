'use client'

import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Footprints,
  Bike,
  Car,
  Bus,
  TrainFront,
  Ship,
  Plane,
  MoveRight,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getTimelineDayHistory, getTimelineDateRange } from "@/app/actions/timeline-actions"
import { AthenaRow } from "@/lib/athena"
import { type DayEvent, ACTIVITY_LABELS } from "@/components/timeline/timeline-shared"

// マップは Leaflet が window 依存のため SSR 無効でクライアントのみ読み込む
const DayRouteMap = dynamic(() => import("@/components/timeline/day-route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] w-full items-center justify-center rounded-md border text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> 地図を読み込み中…
    </div>
  ),
})

const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  WALKING: Footprints,
  RUNNING: Footprints,
  CYCLING: Bike,
  MOTORCYCLING: Bike,
  IN_PASSENGER_VEHICLE: Car,
  IN_BUS: Bus,
  IN_TRAIN: TrainFront,
  IN_SUBWAY: TrainFront,
  IN_TRAM: TrainFront,
  IN_FERRY: Ship,
  SAILING: Ship,
  FLYING: Plane,
}

const HOME_TYPES = new Set(["HOME", "INFERRED_HOME"])
const WORK_TYPES = new Set(["WORK", "INFERRED_WORK"])

function mapRows(rows: AthenaRow[]): DayEvent[] {
  return rows.map((r) => {
    const kind: DayEvent["kind"] = r.kind === "move" ? "move" : "visit"
    const t = r.type_code || ""
    const label =
      kind === "move"
        ? ACTIVITY_LABELS[t] ?? "移動"
        : HOME_TYPES.has(t)
          ? "自宅"
          : r.label || (WORK_TYPES.has(t) ? "職場" : "不明な場所")
    const num = (v: string | undefined) => (v != null && v !== "" ? Number(v) : null)
    return {
      kind,
      in: r.in_t || "",
      out: r.out_t || "",
      dur: Number(r.dur || 0),
      label,
      typeCode: t,
      placeId: r.place_id || "",
      uri: r.uri || undefined,
      lat: num(r.lat),
      lng: num(r.lng),
      endLat: num(r.end_lat),
      endLng: num(r.end_lng),
      distM: Number(r.dist_m || 0),
    }
  })
}

function fmtDur(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m ? `${h}時間${m}分` : `${h}時間`
  }
  return `${min}分`
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

// 正午基準で加減算し、UTC 変換による日付ズレを避ける
function shiftDate(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00`)
  t.setDate(t.getDate() + days)
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, "0")
  const dd = String(t.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

// 取得済みの日をキャッシュし、日付の行き来で再クエリしない
const dayCache = new Map<string, DayEvent[]>()

export function DayHistory() {
  const [date, setDate] = useState<string | null>(null)
  const [range, setRange] = useState<{ min: string; max: string } | null>(null)
  const [events, setEvents] = useState<DayEvent[]>([])
  const [loading, setLoading] = useState(true)
  // 連打時に古い応答で上書きしないよう、最後に要求した日付を持つ
  const reqRef = useRef<string | null>(null)

  // 初回: 最新日の履歴と日付範囲を並行取得
  useEffect(() => {
    let active = true
    Promise.all([getTimelineDayHistory(), getTimelineDateRange()])
      .then(([rows, rangeRows]) => {
        if (!active) return
        const evs = mapRows(rows as AthenaRow[])
        const r = (rangeRows as AthenaRow[])[0]
        const min = r?.min_d || ""
        const max = r?.max_d || ""
        const d = rows[0]?.date || max || null
        if (d) dayCache.set(d, evs)
        setEvents(evs)
        setDate(d)
        if (min && max) setRange({ min, max })
      })
      .catch((e) => console.error("Failed to fetch day history:", e))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  function load(d: string) {
    setDate(d)
    const hit = dayCache.get(d)
    if (hit) {
      reqRef.current = null
      setEvents(hit)
      setLoading(false)
      return
    }
    reqRef.current = d
    setLoading(true)
    getTimelineDayHistory(d)
      .then((rows) => dayCache.set(d, mapRows(rows as AthenaRow[])))
      .catch((e) => {
        console.error("Failed to fetch day history:", e)
        dayCache.set(d, [])
      })
      .finally(() => {
        if (reqRef.current === d) {
          setEvents(dayCache.get(d) ?? [])
          setLoading(false)
        }
      })
  }

  // 滞在に訪問順の番号を振る（マップの番号ピンと対応）
  const numbered = useMemo(() => {
    let no = 0
    return events.map((e) => ({ ...e, no: e.kind === "visit" ? ++no : 0 }))
  }, [events])

  const canPrev = !!date && (!range || date > range.min)
  const canNext = !!date && (!range || date < range.max)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 flex-wrap">
        <CardTitle className="text-xl font-bold">日別の移動履歴</CardTitle>
        <div className="flex items-center gap-2">
          <button
            className="h-9 w-9 rounded-md border bg-muted disabled:opacity-30"
            disabled={!canPrev || loading}
            onClick={() => date && load(shiftDate(date, -1))}
            aria-label="前の日"
          >
            <ChevronLeft className="h-4 w-4 mx-auto" />
          </button>
          <input
            type="date"
            value={date ?? ""}
            min={range?.min}
            max={range?.max}
            disabled={loading && !date}
            onChange={(e) => e.target.value && load(e.target.value)}
            aria-label="日付を選択"
            className="h-9 rounded-md border bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            className="h-9 w-9 rounded-md border bg-muted disabled:opacity-30"
            disabled={!canNext || loading}
            onClick={() => date && load(shiftDate(date, 1))}
            aria-label="次の日"
          >
            <ChevronRight className="h-4 w-4 mx-auto" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> 読み込み中…
          </div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">この日のデータがありません</div>
        ) : (
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* 左: 縦タイムライン */}
            <div className="lg:w-[420px] lg:shrink-0 min-w-0 max-h-[480px] overflow-y-auto pr-2">
              {numbered.map((e, i) => {
                if (e.kind === "visit") {
                  return (
                    <div key={i} className="flex gap-3 py-2">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--chart-2)] text-[11px] font-semibold text-white">
                        {e.no}
                      </div>
                      <div className="min-w-0">
                        <div className={cn("text-sm font-medium truncate", e.label === "自宅" && "text-muted-foreground")}>
                          {e.uri ? (
                            <a href={e.uri} target="_blank" rel="noreferrer" className="hover:underline">
                              {e.label}
                              <MapPin className="inline h-3 w-3 ml-0.5 opacity-60" />
                            </a>
                          ) : (
                            e.label
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {e.in} – {e.out}・{fmtDur(e.dur)}
                        </div>
                      </div>
                    </div>
                  )
                }
                const Icon = ACTIVITY_ICONS[e.typeCode] ?? MoveRight
                return (
                  <div key={i} className="flex items-center gap-2 border-l-2 border-dashed ml-3 pl-4 py-1 text-xs text-muted-foreground tabular-nums">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {e.label}・{fmtDur(e.dur)}
                    {e.distM > 0 && <>・{fmtDist(e.distM)}</>}
                  </div>
                )
              })}
            </div>

            {/* 右: 1日の経路マップ */}
            <div className="min-w-0 lg:flex-1">
              <DayRouteMap events={events} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
