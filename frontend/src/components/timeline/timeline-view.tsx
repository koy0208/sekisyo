'use client'

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ChevronLeft, ChevronRight, ChevronDown, Loader2, Play, Pause, Search, X } from "lucide-react"
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

// レース再生の速度（1 期間あたりのミリ秒）。1x を基準に前後
const SPEEDS: { key: string; ms: number }[] = [
  { key: "0.5x", ms: 2000 },
  { key: "1x", ms: 1100 },
  { key: "2x", ms: 550 },
]

// ローリング集計の窓幅（各フレームで「直近この数のバケット」を合計）。
// 刻み自体は粒度のまま（バケット数は増えない）。中身だけ直近合計になる
const ROLL_WINDOW: Record<Unit, number> = { month: 12, quarter: 4, year: 3 }
const WINDOW_NOTE: Record<Unit, string> = { month: "直近12ヶ月", quarter: "直近4四半期", year: "直近3年" }

// 集計範囲: 選択中の期間のみ（単期間）か、直近ローリング合計か
type WindowMode = "single" | "rolling"
const WINDOW_OPTIONS: { key: WindowMode; label: string }[] = [
  { key: "single", label: "単期間" },
  { key: "rolling", label: "直近合計" },
]

// 場所名の検索用正規化 (全角/半角ゆれと大文字小文字を吸収)
function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase()
}

// 月フィルタ or 名前フィルタで records を場所単位に集約する。
// 表示名/URI は最新月の値を代表採用（records は mon 昇順）
function aggregatePlaces(
  records: RankRow[],
  include: (r: RankRow) => boolean,
  metric: Metric
): PlaceItem[] {
  const agg = new Map<string, PlaceItem>()
  for (const r of records) {
    if (!include(r)) continue
    const a =
      agg.get(r.placeId) ??
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
    if (r.place_name) a.name = r.place_name
    if (r.uri) a.uri = r.uri
    if (a.lat == null && r.lat != null) a.lat = r.lat
    if (a.lng == null && r.lng != null) a.lng = r.lng
    agg.set(r.placeId, a)
  }
  return Array.from(agg.values()).sort((x, y) =>
    metric === "hours" ? y.hours - x.hours : y.visits - x.visits
  )
}

export function TimelineView({ records }: { records: RankRow[] }) {
  const [tab, setTab] = useState<"ranking" | "map">("ranking")
  const [unit, setUnit] = useState<Unit>("month")
  const [metric, setMetric] = useState<Metric>("hours")
  const [pos, setPos] = useState<number>(Number.MAX_SAFE_INTEGER)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speedKey, setSpeedKey] = useState("1x")
  const [windowMode, setWindowMode] = useState<WindowMode>("single")
  const [query, setQuery] = useState("")
  const [suggestOpen, setSuggestOpen] = useState(false)

  const months = useMemo(
    () => Array.from(new Set(records.map((r) => r.mon))).sort(),
    [records]
  )
  const buckets = useMemo(() => buildBuckets(months, unit), [months, unit])
  const safePos = Math.max(0, Math.min(pos, buckets.length - 1))
  const current = buckets[safePos]

  // ローリング窓の下端（safePos を末尾に直近 windowSize 個。先頭付近は有る分だけ）
  // 単期間モードは窓幅 1 = 選択中の期間だけを集計する
  const windowSize = windowMode === "rolling" ? ROLL_WINDOW[unit] : 1
  const winLo = Math.max(0, safePos - windowSize + 1)
  const windowLabel =
    winLo === safePos
      ? current?.label ?? "-"
      : `${buckets[winLo]?.label ?? ""} 〜 ${current?.label ?? ""}`
  const windowNote =
    windowMode === "single"
      ? "選択期間の合計"
      : winLo === 0
        ? "期間開始〜現在の合計"
        : `${WINDOW_NOTE[unit]}の合計`

  const speedMs = SPEEDS.find((s) => s.key === speedKey)?.ms ?? 1100
  // 並べ替えアニメは 1 期間の間隔より少し短くして、次の遷移前に収束させる
  const transitionSec = Math.min(0.8, (speedMs / 1000) * 0.75)

  // 再生中は一定間隔で期間を進める。末尾に達したら自動停止
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setPos((p) => {
        const cur = Math.max(0, Math.min(p, buckets.length - 1))
        if (cur >= buckets.length - 1) {
          setPlaying(false)
          return cur
        }
        return cur + 1
      })
    }, speedMs)
    return () => clearInterval(id)
  }, [playing, speedMs, buckets.length])

  function togglePlay() {
    if (playing) {
      setPlaying(false)
      return
    }
    // 末尾にいるときは先頭から再生し直す
    if (safePos >= buckets.length - 1) setPos(0)
    setPlaying(true)
  }

  // 手動で期間を動かしたら再生を止める（ユーザー操作を優先）
  function gotoPos(p: number) {
    setPlaying(false)
    setPos(p)
  }

  function changeUnit(u: Unit) {
    const next = buildBuckets(months, u)
    setPlaying(false)
    setUnit(u)
    setPos(next.length - 1)
  }

  // 場所の集約（指標で降順）。直近 windowSize バケットぶんの月をまとめて合計する
  const items = useMemo<PlaceItem[]>(() => {
    if (!buckets.length) return []
    const set = new Set<string>()
    for (let i = winLo; i <= safePos; i++) {
      for (const m of buckets[i]?.months ?? []) set.add(m)
    }
    return aggregatePlaces(records, (r) => set.has(r.mon), metric)
  }, [records, buckets, winLo, safePos, metric])

  // 名前検索は期間と独立に全期間から探す（「あの店いつ行ったっけ」に答えるため。
  // 期間内フィルタだと窓の外の場所が見つからない）
  const searchItems = useMemo<PlaceItem[] | null>(() => {
    const q = normalize(query.trim())
    if (!q) return null
    return aggregatePlaces(records, (r) => normalize(r.place_name).includes(q), metric)
  }, [records, query, metric])

  const searching = searchItems !== null
  const shownItems = searchItems ?? items
  // 入力欄直下のドロップダウン候補 (上位のみ。全件は下の一覧で見る)
  const suggestions = suggestOpen ? (searchItems ?? []).slice(0, 8) : []

  // 候補クリックで場所を選択して詳細を開く。query は残す
  // (クリアすると期間ビューに戻り、窓の外の場所は選択が解決できなくなるため)
  function pickSuggestion(placeId: string) {
    setSelectedId(placeId)
    setSuggestOpen(false)
  }

  // 選択中の場所（place_id 一致）。期間切替で対象が消えたら null 扱い
  const cur = useMemo(() => shownItems.find((i) => i.placeId === selectedId), [shownItems, selectedId])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 flex-wrap">
        <CardTitle className="text-xl font-bold tabular-nums">
          {searching ? "検索結果" : windowLabel}
        </CardTitle>
        <div className="flex gap-2 flex-wrap">
          <Toggle options={UNIT_OPTIONS} value={unit} onChange={changeUnit} />
          <Toggle options={WINDOW_OPTIONS} value={windowMode} onChange={setWindowMode} />
          <Toggle options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
        </div>
      </CardHeader>
      <CardContent>
        {/* 場所名の検索。入力中は期間を無視して全期間から探す */}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSuggestOpen(true)
              setPlaying(false)
            }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setSuggestOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSuggestOpen(false)
            }}
            placeholder="場所名で検索（全期間から）"
            aria-label="場所名で検索"
            className="h-9 w-full rounded-md border bg-background pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="検索をクリア"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* 入力欄直下の候補。クリックで選択して詳細を開く (両タブ共通)。
              onMouseDown で input の blur より先に選択を確定させる */}
          {suggestions.length > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-card shadow-md">
              {suggestions.map((s) => (
                <button
                  key={s.placeId}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickSuggestion(s.placeId)
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {s.hours.toFixed(1)}h / {s.visits}回
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {searching && (
          <p className="text-xs text-muted-foreground">
            「{query.trim()}」に一致: {shownItems.length} ヶ所（全期間の合計）
          </p>
        )}

        {/* 期間ナビ（両タブ共有）: 矢印で前後、ドロップダウンで任意の期間へジャンプ */}
        <div className={`flex flex-wrap items-center gap-3 ${searching ? "hidden" : ""}`}>
          <button
            className="h-9 w-9 rounded-md border bg-muted disabled:opacity-30"
            disabled={safePos <= 0}
            onClick={() => gotoPos(safePos - 1)}
            aria-label="前の期間"
          >
            <ChevronLeft className="h-4 w-4 mx-auto" />
          </button>
          <div className="relative flex-1 min-w-[180px]">
            <select
              value={safePos}
              onChange={(e) => gotoPos(Number(e.target.value))}
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
            onClick={() => gotoPos(safePos + 1)}
            aria-label="次の期間"
          >
            <ChevronRight className="h-4 w-4 mx-auto" />
          </button>

          {/* レース再生コントロール */}
          <button
            className="flex h-9 items-center gap-1.5 rounded-md border bg-primary px-3 text-sm text-primary-foreground disabled:opacity-30"
            disabled={buckets.length <= 1}
            onClick={togglePlay}
            aria-label={playing ? "一時停止" : "再生"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "停止" : "再生"}
          </button>
          <Toggle options={SPEEDS.map((s) => ({ key: s.key, label: s.key }))} value={speedKey} onChange={setSpeedKey} />
        </div>
        {!searching && (
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            全{buckets.length}期間中 {safePos + 1}番目・{windowNote}
          </p>
        )}

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
              items={shownItems}
              records={records}
              buckets={buckets}
              safePos={safePos}
              unit={unit}
              metric={metric}
              selectedId={selectedId}
              onSelect={setSelectedId}
              transitionSec={transitionSec}
              emptyMessage={searching ? "一致する場所がありません" : undefined}
            />
          </TabsContent>

          <TabsContent value="map" className="mt-4">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 lg:flex-1">
                <TimelineMap
                  items={shownItems}
                  metric={metric}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
              <div className="min-w-0 lg:w-[420px] lg:shrink-0 lg:border-l lg:pl-6">
                {!cur ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    ピンをクリックすると、ここに詳細が表示されます
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
                    onClose={() => setSelectedId(null)}
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
