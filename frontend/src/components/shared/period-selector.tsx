import Link from "next/link"
import { PERIODS } from "@/lib/period"

// searchParams ベースの共通期間セレクタ。extraParams で月指定など
// ページ固有のクエリパラメータを維持する
export function PeriodSelector({
  basePath,
  currentKey,
  extraParams,
}: {
  basePath: string
  currentKey: string
  extraParams?: Record<string, string>
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PERIODS.map((opt) => {
        const params = new URLSearchParams({ ...extraParams, period: opt.key })
        return (
          <Link
            key={opt.key}
            href={`${basePath}?${params.toString()}`}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              currentKey === opt.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            {opt.label}
          </Link>
        )
      })}
    </div>
  )
}
