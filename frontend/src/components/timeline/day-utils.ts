// 日別タイムラインの変換・表示ヘルパー。
// Server Component (/day/[date]) からも使うため 'use client' を付けない。

import { type TimelineDayEventRow } from "@/lib/mart-types"
import { type DayEvent } from "@/components/timeline/timeline-shared"

// Google Timeline の activity_type → 日本語ラベル
export const ACTIVITY_LABELS: Record<string, string> = {
  WALKING: "徒歩",
  RUNNING: "ランニング",
  CYCLING: "自転車",
  IN_PASSENGER_VEHICLE: "車",
  MOTORCYCLING: "バイク",
  IN_BUS: "バス",
  IN_TRAIN: "電車",
  IN_SUBWAY: "地下鉄",
  IN_TRAM: "路面電車",
  IN_FERRY: "フェリー",
  SAILING: "船",
  FLYING: "飛行機",
  SKIING: "スキー",
  UNKNOWN_ACTIVITY_TYPE: "移動",
}

const HOME_TYPES = new Set(["HOME", "INFERRED_HOME"])
const WORK_TYPES = new Set(["WORK", "INFERRED_WORK"])

// マートの 1 日分イベントを表示用 DayEvent に変換 (自宅置換・移動種別の和訳を解決)
export function mapDayEvents(rows: TimelineDayEventRow[]): DayEvent[] {
  return rows.map((r) => {
    const kind: DayEvent["kind"] = r.kind === "move" ? "move" : "visit"
    const t = r.type_code || ""
    const label =
      kind === "move"
        ? ACTIVITY_LABELS[t] ?? "移動"
        : HOME_TYPES.has(t)
          ? "自宅"
          : r.label || (WORK_TYPES.has(t) ? "職場" : "不明な場所")
    return {
      kind,
      in: r.in_t,
      out: r.out_t,
      dur: r.dur,
      label,
      typeCode: t,
      placeId: r.place_id || "",
      uri: r.uri ?? undefined,
      lat: r.lat,
      lng: r.lng,
      endLat: r.end_lat,
      endLng: r.end_lng,
      distM: r.dist_m ?? 0,
    }
  })
}

export function fmtDur(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return m ? `${h}時間${m}分` : `${h}時間`
  }
  return `${min}分`
}

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

// 正午基準で加減算し、UTC 変換による日付ズレを避ける
export function shiftDate(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00`)
  t.setDate(t.getDate() + days)
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, "0")
  const dd = String(t.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}
