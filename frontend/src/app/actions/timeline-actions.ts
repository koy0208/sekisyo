'use server'

import { runAthenaQuery } from "@/lib/athena";

const TIMELINE_DB = 'sekisyo'

// 自宅・親エリア・低確度を除外した「外出先の滞在」共通条件
const VISIT_FILTER = `
  hierarchy_level = 0
  AND probability >= 0.5
  AND semantic_type NOT IN ('HOME', 'INFERRED_HOME')
  AND place_name IS NOT NULL
`

// 月 × 場所の集計（ランキング用）。クライアントで月/四半期/年に再集計する
export async function getTimelineRanking() {
  const query = `
    SELECT
      substr(date, 1, 7) AS mon,
      place_id,
      max(place_name) AS place_name,
      max(google_maps_uri) AS uri,
      max(lat) AS lat,
      max(lng) AS lng,
      count(*) AS visits,
      round(sum(duration_min) / 60.0, 1) AS hours
    FROM visits
    WHERE ${VISIT_FILTER}
    GROUP BY substr(date, 1, 7), place_id
    ORDER BY mon
  `
  return await runAthenaQuery(query, TIMELINE_DB)
}

// 1 場所の訪問明細（ドリルダウンのテーブル用）。クリック時に都度取得する。
// 集計（getTimelineRanking）が place_id 単位なので、明細も place_id で揃える
// （place_name は表記揺れ・名称変更で 1 場所に複数あり得るため一致条件に使わない）
export async function getTimelinePlaceVisits(placeId: string) {
  // 自前データだが念のためシングルクオートをエスケープ
  const safe = placeId.replace(/'/g, "''")
  const query = `
    SELECT
      date,
      date_format(start_time, '%a') AS dow,
      date_format(start_time, '%H:%i') AS in_t,
      date_format(end_time, '%H:%i') AS out_t,
      duration_min AS dur
    FROM visits
    WHERE ${VISIT_FILTER}
      AND place_id = '${safe}'
    ORDER BY start_time
  `
  return await runAthenaQuery(query, TIMELINE_DB)
}
