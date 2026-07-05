import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 失敗したデータセットは null にして、カード単位でエラー表示する
// (ページ全体の catch で握りつぶすと障害が「全部ゼロの正常画面」に見える)
export async function settle<T>(promise: Promise<T>, name: string): Promise<T | null> {
  try {
    return await promise
  } catch (error) {
    console.error(`Failed to fetch ${name}:`, error)
    return null
  }
}

// "2026-07-04" → "7/4"
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number)
  return `${m}/${d}`
}

// 日付の加減算 ("2026-07-04", -1 → "2026-07-03")。
// 正午基準で計算し、UTC 変換による日付ズレを避ける
export function shiftDate(d: string, days: number): string {
  const t = new Date(`${d}T12:00:00`)
  t.setDate(t.getDate() + days)
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, "0")
  const dd = String(t.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

// 週の開始日 (月曜)。旧 Athena クエリの date_trunc('week') と同じ基準。
// 正午基準で計算し、UTC 変換による日付ズレを避ける
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
