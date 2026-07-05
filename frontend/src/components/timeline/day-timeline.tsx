'use client'

import { useMemo } from "react"
import dynamic from "next/dynamic"
import {
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
import { type DayEvent } from "@/components/timeline/timeline-shared"
import { fmtDur, fmtDist } from "@/components/timeline/day-utils"

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

// 1 日分のタイムライン (縦リスト + 経路マップ)。
// データ取得は呼び出し側 (Server Component) が行い、ここは描画のみ
export function DayTimeline({ events }: { events: DayEvent[] }) {
  // 滞在に訪問順の番号を振る（マップの番号ピンと対応）
  const numbered = useMemo(() => {
    let no = 0
    return events.map((e) => ({ ...e, no: e.kind === "visit" ? ++no : 0 }))
  }, [events])

  if (events.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">この日のデータがありません</div>
  }

  return (
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
  )
}
