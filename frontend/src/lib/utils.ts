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
