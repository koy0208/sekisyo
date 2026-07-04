'use client'

// 想定外の例外のフォールバック(データ取得の失敗はカード単位で表示する。
// docs/redesign/03-ui-unification.md 3d)
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-bold">エラーが発生しました</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        再読み込み
      </button>
    </div>
  )
}
