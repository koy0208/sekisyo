import { AlertTriangle } from "lucide-react"

// データ取得失敗時のカード内表示。従来は catch で握りつぶして
// 「全部ゼロの正常画面」になっていた(docs/redesign/03-ui-unification.md 3d)
export function DataError({ message }: { message?: string }) {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <AlertTriangle className="h-5 w-5" />
      {message ?? "データを取得できませんでした"}
    </div>
  )
}
