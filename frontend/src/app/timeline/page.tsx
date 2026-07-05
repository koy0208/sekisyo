import Link from "next/link"
import { TimelineView } from "@/components/timeline/timeline-view"
import { type RankRow } from "@/components/timeline/timeline-shared"
import { fetchMart } from "@/lib/marts"
import { type MartMeta, type TimelineRankingRow } from "@/lib/mart-types"
import { settle } from "@/lib/utils"
import { CalendarDays, ChevronRight } from "lucide-react"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

export default async function TimelinePage() {
  const [rawRanking, meta] = await Promise.all([
    settle(fetchMart<TimelineRankingRow[]>("timeline_ranking.json"), "timeline ranking mart"),
    settle(fetchMart<MartMeta>("meta.json"), "mart meta"),
  ])

  const records: RankRow[] = (rawRanking ?? []).map((row) => ({
    mon: row.mon,
    placeId: row.place_id,
    place_name: row.place_name || '不明',
    uri: row.uri ?? undefined,
    lat: row.lat,
    lng: row.lng,
    visits: row.visits,
    hours: row.hours,
  }))

  const latestDay = meta?.sources.timeline.last_date

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">タイムライン</h2>
        <p className="text-sm text-muted-foreground">
          外出先の滞在を集計したランキング（自宅除外）。期間の単位を切替え、場所をクリックで訪問の詳細を表示。
        </p>
        <TimelineView records={records} />
        {/* 日別の移動履歴はデイビュー (/day/[date]) に統合した */}
        {latestDay && (
          <Link
            href={`/day/${latestDay}`}
            className="flex items-center justify-between rounded-lg border bg-card p-4 text-sm transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-2 font-medium">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              日別の移動履歴を見る（デイビュー）
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}
      </div>
    </div>
  )
}
