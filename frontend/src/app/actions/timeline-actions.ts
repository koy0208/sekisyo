'use server'

import { fetchMart, fetchMartOrNull } from "@/lib/marts"
import { assertIsoDate } from "@/lib/query-guards"
import type { MartMeta, TimelineDayEventRow, TimelinePlaceVisitRow } from "@/lib/mart-types"

// クライアントコンポーネントから呼ぶマート読みの薄い層。
// 集計は mart_builder Lambda 側で済んでおり、ここでは取得と絞り込みのみ行う。

// 1 日分の移動履歴。date 省略時はデータが存在する最新日を返す
// (イベントに date 列を含むのでクライアントで判別可能)
export async function getTimelineDayHistory(date?: string): Promise<TimelineDayEventRow[]> {
  let target = date
  if (!target) {
    const meta = await fetchMart<MartMeta>("meta.json")
    target = meta.sources.timeline.last_date ?? undefined
    if (!target) return []
  }
  // S3 キーに埋め込むため形式を検証する (パス操作の防止)
  const events = await fetchMartOrNull<TimelineDayEventRow[]>(
    `timeline_days/${assertIsoDate(target)}.json`
  )
  return events ?? []
}

// 日別ナビの範囲(データが存在する最初と最後の日)
export async function getTimelineDateRange(): Promise<{ min: string | null; max: string | null }> {
  const meta = await fetchMart<MartMeta>("meta.json")
  return {
    min: meta.sources.timeline.first_date,
    max: meta.sources.timeline.last_date,
  }
}

// 1 場所の訪問明細(ドリルダウンのテーブル用)。マートは全訪問を 1 ファイルで持ち
// (サーバ側でキャッシュされる)、place_id での絞り込みだけここで行う
export async function getTimelinePlaceVisits(placeId: string): Promise<TimelinePlaceVisitRow[]> {
  const all = await fetchMart<TimelinePlaceVisitRow[]>("timeline_place_visits.json")
  return all.filter((v) => v.place_id === placeId)
}
