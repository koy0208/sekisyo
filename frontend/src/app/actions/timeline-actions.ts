'use server'

import { fetchMart } from "@/lib/marts"
import type { TimelinePlaceVisitRow } from "@/lib/mart-types"

// クライアントコンポーネントから呼ぶマート読みの薄い層。
// 集計は mart_builder Lambda 側で済んでおり、ここでは取得と絞り込みのみ行う。

// 1 場所の訪問明細(ドリルダウンのテーブル用)。マートは全訪問を 1 ファイルで持ち
// (サーバ側でキャッシュされる)、place_id での絞り込みだけここで行う
export async function getTimelinePlaceVisits(placeId: string): Promise<TimelinePlaceVisitRow[]> {
  const all = await fetchMart<TimelinePlaceVisitRow[]>("timeline_place_visits.json")
  return all.filter((v) => v.place_id === placeId)
}
