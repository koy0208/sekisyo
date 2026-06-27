'use client'

import { MapPin, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { PlaceDetail } from "@/components/timeline/place-detail"
import {
  type RankRow,
  type PlaceItem,
  type Bucket,
  type Unit,
  type Metric,
} from "@/components/timeline/timeline-shared"

// page.tsx の互換のため再エクスポート
export type { RankRow } from "@/components/timeline/timeline-shared"

export function TimelineExplorer({
  items,
  records,
  buckets,
  safePos,
  unit,
  metric,
  selectedId,
  onSelect,
}: {
  items: PlaceItem[]
  records: RankRow[]
  buckets: Bucket[]
  safePos: number
  unit: Unit
  metric: Metric
  selectedId: string | null
  onSelect: (placeId: string | null) => void
}) {
  const maxVal = Math.max(...items.map((i) => (metric === "hours" ? i.hours : i.visits)), 1)
  const cur = items.find((i) => i.placeId === selectedId)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* 左: ランキング（スクロール・全件） */}
      <div className="lg:w-1/2 min-w-0">
        <div className="max-h-[540px] overflow-y-auto pr-2 space-y-2">
          {items.map((it, i) => {
            const v = metric === "hours" ? it.hours : it.visits
            const w = (v / maxVal) * 100
            const selected = it.placeId === selectedId
            return (
              <div
                key={it.placeId}
                onClick={() => onSelect(it.placeId)}
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
        {!cur ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            ← ランキングの行をクリックすると、ここに詳細が表示されます
          </div>
        ) : (
          <PlaceDetail
            placeId={cur.placeId}
            name={cur.name}
            records={records}
            buckets={buckets}
            safePos={safePos}
            unit={unit}
            metric={metric}
            onClose={() => onSelect(null)}
          />
        )}
      </div>
    </div>
  )
}
