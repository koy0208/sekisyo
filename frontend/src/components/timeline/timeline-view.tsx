'use client'

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ChevronLeft, ChevronRight, ChevronDown, Loader2 } from "lucide-react"
import { TimelineExplorer } from "@/components/timeline/timeline-explorer"
import { PlaceDetail } from "@/components/timeline/place-detail"
import {
  type RankRow,
  type PlaceItem,
  type Unit,
  type Metric,
  UNIT_OPTIONS,
  METRIC_OPTIONS,
  buildBuckets,
  Toggle,
} from "@/components/timeline/timeline-shared"

// マップは Leaflet が window 依存のため SSR 無効でクライアントのみ読み込む
// （server component では ssr:false 不可なので、この client component 内で行う）
const TimelineMap = dynamic(() => import("@/components/timeline/timeline-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] w-full items-center justify-center rounded-md border text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> 地図を読み込み中…
    </div>
  ),
})

export function TimelineView({ records }: { records: RankRow[] }) {
  const [tab, setTab] = useState<"ranking" | "map">("ranking")
  const [unit, setUnit] = useState<Unit>("month")
  const [metric, setMetric] = useState<Metric>("hours")
  const [pos, setPos] = useState<number>(Number.MAX_SAFE_INTEGER)
  const [placeName, setPlaceName] = useState<string | null>(null)

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

  // 選択中の区切りの場所集約（指標で降順）。マップ用に lat/lng/uri/placeId を保持
  const items = useMemo<PlaceItem[]>(() => {
    if (!current) return []
    const set = new Set(current.months)
    const agg = new Map<string, PlaceItem>()
    for (const r of records) {
      if (!set.has(r.mon)) continue
      const a =
        agg.get(r.place_name) ??
        ({
          name: r.place_name,
          placeId: r.placeId,
          uri: r.uri,
          lat: r.lat,
          lng: r.lng,
          visits: 0,
          hours: 0,
        } as PlaceItem)
      a.visits += r.visits
      a.hours += r.hours
      if (a.lat == null && r.lat != null) a.lat = r.lat
      if (a.lng == null && r.lng != null) a.lng = r.lng
      agg.set(r.place_name, a)
    }
    return Array.from(agg.values()).sort((x, y) =>
      metric === "hours" ? y.hours - x.hours : y.visits - x.visits
    )
  }, [records, current, metric])

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
        {/* 期間ナビ（両タブ共有）: 矢印で前後、ドロップダウンで任意の期間へジャンプ */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="h-9 w-9 rounded-md border bg-muted disabled:opacity-30"
            disabled={safePos <= 0}
            onClick={() => setPos(safePos - 1)}
            aria-label="前の期間"
          >
            <ChevronLeft className="h-4 w-4 mx-auto" />
          </button>
          <div className="relative flex-1 min-w-[180px]">
            <select
              value={safePos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label="期間を選択"
              className="w-full h-9 appearance-none rounded-md border bg-background pl-3 pr-9 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {/* 最新の期間を上に表示（value は時系列の位置インデックス） */}
              {buckets
                .map((b, i) => ({ idx: i, label: b.label }))
                .reverse()
                .map((o) => (
                  <option key={o.idx} value={o.idx}>
                    {o.label}
                  </option>
                ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <button
            className="h-9 w-9 rounded-md border bg-muted disabled:opacity-30"
            disabled={safePos >= buckets.length - 1}
            onClick={() => setPos(safePos + 1)}
            aria-label="次の期間"
          >
            <ChevronRight className="h-4 w-4 mx-auto" />
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          全{buckets.length}期間中 {safePos + 1}番目
        </p>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "ranking" | "map")}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="ranking">ランキング</TabsTrigger>
            <TabsTrigger value="map">マップ</TabsTrigger>
          </TabsList>

          <TabsContent value="ranking" className="mt-4">
            <TimelineExplorer
              items={items}
              records={records}
              buckets={buckets}
              safePos={safePos}
              unit={unit}
              metric={metric}
              curName={placeName}
              onSelect={setPlaceName}
            />
          </TabsContent>

          <TabsContent value="map" className="mt-4">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 lg:flex-1">
                <TimelineMap
                  items={items}
                  metric={metric}
                  selectedName={placeName}
                  onSelect={setPlaceName}
                />
              </div>
              <div className="min-w-0 lg:w-[420px] lg:shrink-0 lg:border-l lg:pl-6">
                {!placeName ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    ピンをクリックすると、ここに詳細が表示されます
                  </div>
                ) : (
                  <PlaceDetail
                    name={placeName}
                    records={records}
                    buckets={buckets}
                    safePos={safePos}
                    unit={unit}
                    metric={metric}
                    onClose={() => setPlaceName(null)}
                  />
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
