'use client'

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Check, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { triggerSync, getMartGeneratedAt, refreshMartCache } from "@/app/actions/sync-actions"

const POLL_INTERVAL_MS = 20_000
// ETL + タイムライン変換待ち + マート生成の最悪ケースを見込む
const POLL_TIMEOUT_MS = 15 * 60_000

type SyncState = "idle" | "running" | "done" | "error"

// データ連携の手動トリガー。起動後は meta.json の generated_at を
// ポーリングし、変わったらキャッシュを無効化してページを再描画する
export function SyncButton({ baseline }: { baseline: string | null }) {
  const router = useRouter()
  const [state, setState] = useState<SyncState>("idle")
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  async function onClick() {
    setState("running")
    try {
      await triggerSync()
    } catch (e) {
      console.error("Failed to trigger sync:", e)
      setState("error")
      return
    }
    const startedAt = Date.now()
    timerRef.current = setInterval(async () => {
      try {
        const generatedAt = await getMartGeneratedAt()
        if (generatedAt && generatedAt !== baseline) {
          if (timerRef.current) clearInterval(timerRef.current)
          await refreshMartCache()
          setState("done")
          router.refresh()
          return
        }
      } catch {
        // 一時的な取得失敗はポーリング継続
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (timerRef.current) clearInterval(timerRef.current)
        setState("error")
      }
    }, POLL_INTERVAL_MS)
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={state === "running"}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border bg-muted px-3 text-xs font-medium transition-colors",
          state === "running" ? "opacity-60" : "hover:bg-muted/70"
        )}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", state === "running" && "animate-spin")} />
        {state === "running" ? "更新中…" : "家計簿・位置情報を更新"}
      </button>
      {state === "running" && (
        <span className="text-xs text-muted-foreground">数分かかります（完了で自動反映）</span>
      )}
      {state === "done" && (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3.5 w-3.5" /> 更新完了
        </span>
      )}
      {state === "error" && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <TriangleAlert className="h-3.5 w-3.5" /> 更新を確認できませんでした
        </span>
      )}
    </span>
  )
}
