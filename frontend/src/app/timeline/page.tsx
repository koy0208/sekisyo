import { TimelineExplorer, type RankRow } from "@/components/timeline/timeline-explorer"
import { getTimelineRanking } from "@/app/actions/timeline-actions"
import { AthenaRow } from "@/lib/athena"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

export default async function TimelinePage() {
  let records: RankRow[] = []

  try {
    const rawRanking = await getTimelineRanking()
    records = rawRanking.map((row: AthenaRow) => ({
      mon: row.mon || '',
      place_name: row.place_name || '不明',
      uri: row.uri || undefined,
      visits: Number(row.visits || 0),
      hours: Number(row.hours || 0),
    }))
  } catch (error) {
    console.error("Failed to fetch timeline data from Athena:", error)
  }

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-8 pt-6">
        <h2 className="text-3xl font-bold tracking-tight">Timeline</h2>
        <p className="text-sm text-muted-foreground">
          外出先の滞在を集計したランキング（自宅除外）。期間の単位を切替え、場所をクリックで訪問の詳細を表示。
        </p>
        <TimelineExplorer records={records} />
      </div>
    </div>
  )
}
