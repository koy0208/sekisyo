// Server Action は実体が公開 POST エンドポイントで、引数の TS 型は実行時に
// 強制されない。外部入力を S3 キーなどに埋め込む値は必ずここのガードを通す
// (docs/redesign/01-security.md。Athena 撤去前は SQL 用の検証もここに集約していた)。

export function assertIsoDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${date}`)
  }
  return date
}
