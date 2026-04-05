'use client'

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]

export function MonthPicker({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()
  const [year, month] = currentMonth.split('-').map(Number)
  const [viewYear, setViewYear] = useState(year)
  const [open, setOpen] = useState(false)

  const handleSelect = (m: number) => {
    const ym = `${viewYear}-${String(m).padStart(2, '0')}`
    router.push(`/budget?month=${ym}`)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
        <Calendar className="h-4 w-4" />
        {year}年{month}月
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setViewYear(v => v - 1)}
            className="p-1 hover:bg-accent rounded-md transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium">{viewYear}年</span>
          <button
            onClick={() => setViewYear(v => v + 1)}
            className="p-1 hover:bg-accent rounded-md transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((label, i) => {
            const m = i + 1
            const isSelected = viewYear === year && m === month
            return (
              <button
                key={m}
                onClick={() => handleSelect(m)}
                className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
