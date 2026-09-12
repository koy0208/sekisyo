'use client'

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ja } from "date-fns/locale"
import { type Matcher } from "react-day-picker"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { shiftDate } from "@/lib/utils"

// デイビューの日付ナビ。前後 1 日 / 1 週間の移動に加えて、
// カレンダー (月・年ドロップダウン付き) から任意の日へ直接ジャンプする。
// データのある範囲 (minDate〜maxDate) の外へは移動できない。

// 正午基準で扱い、UTC 変換による日付ズレを避ける (lib/utils の shiftDate と同じ方針)
function toDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`)
}

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

// ±7 日ジャンプがデータ範囲の端を飛び越えないよう丸める
function clamp(d: string, minDate?: string, maxDate?: string): string {
  if (minDate && d < minDate) return minDate
  if (maxDate && d > maxDate) return maxDate
  return d
}

function NavButton({
  target,
  disabled,
  label,
  children,
}: {
  target: string
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => router.push(`/day/${target}`)}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted transition-colors hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function DayDateNav({
  date,
  minDate,
  maxDate,
}: {
  date: string
  minDate?: string
  maxDate?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const atMin = !!minDate && date <= minDate
  const atMax = !!maxDate && date >= maxDate

  // データ範囲の外側は選択不可にする
  const disabledDays: Matcher[] = []
  if (minDate) disabledDays.push({ before: toDate(minDate) })
  if (maxDate) disabledDays.push({ after: toDate(maxDate) })

  function go(iso: string) {
    setOpen(false)
    if (iso !== date) router.push(`/day/${iso}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <NavButton target={clamp(shiftDate(date, -7), minDate, maxDate)} disabled={atMin} label="1週間前">
        <ChevronsLeft className="h-4 w-4" />
      </NavButton>
      <NavButton target={shiftDate(date, -1)} disabled={atMin} label="前の日">
        <ChevronLeft className="h-4 w-4" />
      </NavButton>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
          <CalendarDays className="h-4 w-4" />
          日付を選択
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            locale={ja}
            captionLayout="dropdown"
            selected={toDate(date)}
            defaultMonth={toDate(date)}
            startMonth={minDate ? toDate(minDate) : undefined}
            endMonth={maxDate ? toDate(maxDate) : undefined}
            disabled={disabledDays}
            onSelect={(d) => d && go(toIso(d))}
          />
        </PopoverContent>
      </Popover>

      <NavButton target={shiftDate(date, 1)} disabled={atMax} label="次の日">
        <ChevronRight className="h-4 w-4" />
      </NavButton>
      <NavButton target={clamp(shiftDate(date, 7), minDate, maxDate)} disabled={atMax} label="1週間後">
        <ChevronsRight className="h-4 w-4" />
      </NavButton>

      {maxDate && (
        <button
          type="button"
          onClick={() => go(maxDate)}
          disabled={atMax}
          title="データのある最新の日へ"
          className="h-9 rounded-md border bg-muted px-3 text-xs transition-colors hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-30"
        >
          最新
        </button>
      )}
    </div>
  )
}
