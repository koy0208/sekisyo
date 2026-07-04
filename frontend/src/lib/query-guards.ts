// Server Action は実体が公開 POST エンドポイントで、引数の TS 型は実行時に
// 強制されない。SQL に直接埋め込む値は必ずここのガードを通す(SQL インジェクション対策)。
// 各 action ファイルに散らばっていた検証の一元化(docs/redesign/01-security.md)。

// interval の単位は固定の allowlist のみ許可する
const ALLOWED_UNITS = new Set(['day', 'week', 'month', 'year'])

export function assertUnit(unit: string): string {
  if (!ALLOWED_UNITS.has(unit)) {
    throw new Error(`Invalid unit: ${unit}`)
  }
  return unit
}

// interval の数量は正の整数のみ許可する
export function assertAmount(amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`)
  }
  return amount
}

export function assertYearMonth(yearMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`)
  }
  return yearMonth
}

export function assertIsoDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date}`)
  }
  return date
}

// 文字列リテラルとして埋め込む値のエスケープ(place_id 等)
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}
