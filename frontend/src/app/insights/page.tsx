import { DataError } from "@/components/shared/data-error"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CorrelationExplorer,
  TagComparison,
  type CorrelationPoint,
} from "@/components/insights/correlation-explorer"
import { fetchMart } from "@/lib/marts"
import { type DailyRow } from "@/lib/mart-types"
import { settle } from "@/lib/utils"
import { PLACE_TAGS } from "@/config/place-tags"

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

// 相関ビュー (docs/redesign/04-cross-features.md 4d)。
// AI に任せる前に自分の目で見るための、daily マートの散布図/対比ビュー。
// 集計・描画はすべてクライアント側で行い、新規バックエンドは持たない。

export default async function InsightsPage() {
  const daily = await settle(fetchMart<DailyRow[]>("daily.json"), "daily mart")

  // クライアントに渡すのは相関に使う数値列だけに絞る (RSC ペイロード削減)。
  // 支出は Money Forward 由来の負値を正の支出額に直す
  const points: CorrelationPoint[] = (daily ?? []).map((r) => ({
    date: r.date,
    steps: r.steps,
    sleep_hours: r.sleep_hours,
    active_zone_min: r.active_zone_min,
    low_intensity_min: r.low_intensity_min,
    spending: r.spending_total != null ? Math.abs(r.spending_total) : null,
    out_hours: r.out_hours,
    visit_count: r.visit_count,
    tags: (r.top_places ?? [])
      .map((p) => PLACE_TAGS[p.place_id])
      .filter((t): t is string => t != null),
  }))

  return (
    <div className="flex-col md:flex">
      <div className="flex-1 space-y-4 p-4 md:p-8 md:pt-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">相関</h2>
        <p className="text-sm text-muted-foreground">
          日次データの指標同士の関係を散布図で探索。ラグ指定で「前日の運動 × 当日の睡眠」のような比較もできる。
        </p>

        {daily === null ? (
          <Card>
            <CardHeader>
              <CardTitle>散布図</CardTitle>
            </CardHeader>
            <CardContent>
              <DataError />
            </CardContent>
          </Card>
        ) : (
          <>
            <CorrelationExplorer data={points} />
            <TagComparison data={points} />
          </>
        )}
      </div>
    </div>
  )
}
