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

// 1 日分の移動履歴（滞在 visits + 移動 activities を時系列に統合）。
// 日別ビューは自宅も含めて 1 日の流れを見せる（HOME 除外はランキングのみ）。
// date 省略時はデータが存在する最新日を返す（date 列を含むのでクライアントで判別可能）
export async function getTimelineDayHistory(date?: string) {
  const dateExpr = date
    ? `'${date.replace(/'/g, "''")}'`
    : `(SELECT max(date) FROM visits WHERE hierarchy_level = 0)`
  const query = `
    SELECT
      kind, date, in_t, out_t, dur, label, type_code,
      place_id, uri, lat, lng, end_lat, end_lng, dist_m
    FROM (
      SELECT
        'visit' AS kind,
        date,
        date_format(start_time, '%H:%i') AS in_t,
        date_format(end_time, '%H:%i') AS out_t,
        duration_min AS dur,
        place_name AS label,
        semantic_type AS type_code,
        place_id,
        google_maps_uri AS uri,
        lat,
        lng,
        CAST(NULL AS double) AS end_lat,
        CAST(NULL AS double) AS end_lng,
        CAST(NULL AS double) AS dist_m,
        start_time
      FROM visits
      WHERE hierarchy_level = 0 AND date = ${dateExpr}
      UNION ALL
      SELECT
        'move' AS kind,
        date,
        date_format(start_time, '%H:%i') AS in_t,
        date_format(end_time, '%H:%i') AS out_t,
        duration_min AS dur,
        CAST(NULL AS varchar) AS label,
        activity_type AS type_code,
        CAST(NULL AS varchar) AS place_id,
        CAST(NULL AS varchar) AS uri,
        start_lat AS lat,
        start_lng AS lng,
        end_lat,
        end_lng,
        distance_m AS dist_m,
        start_time
      FROM activities
      WHERE date = ${dateExpr}
    )
    ORDER BY start_time
  `
  return await runAthenaQuery(query, TIMELINE_DB)
}

// 日別ナビの範囲（データが存在する最初と最後の日）
export async function getTimelineDateRange() {
  const query = `
    SELECT min(date) AS min_d, max(date) AS max_d
    FROM visits
    WHERE hierarchy_level = 0
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
