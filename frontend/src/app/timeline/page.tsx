import { TimelineView } from "@/components/timeline/timeline-view"
import { DayHistory } from "@/components/timeline/day-history"
import { type RankRow } from "@/components/timeline/timeline-shared"
import { fetchMart } from "@/lib/marts"
import { type TimelineRankingRow } from "@/lib/mart-types"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

export default async function TimelinePage() {
  let records: RankRow[] = []

  try {
    const rawRanking = await fetchMart<TimelineRankingRow[]>("timeline_ranking.json")
    records = rawRanking.map((row) => ({
      mon: row.mon,
      placeId: row.place_id,
      place_name: row.place_name || '不明',
      uri: row.uri ?? undefined,
      lat: row.lat,
      lng: row.lng,
      visits: row.visits,
      hours: row.hours,
    }))
  } catch (error) {
    console.error("Failed to fetch timeline ranking mart:", error)
  }

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">タイムライン</h2>
        <p className="text-sm text-muted-foreground">
          外出先の滞在を集計したランキング（自宅除外）。期間の単位を切替え、場所をクリックで訪問の詳細を表示。
        </p>
        <TimelineView records={records} />
        <DayHistory />
      </div>
    </div>
  )
}
