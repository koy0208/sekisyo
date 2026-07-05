'use client'

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CumulativeSpendingChart } from "@/components/budget/budget-charts"
import { CategoryFilter } from "@/components/budget/category-filter"

interface DailyCategoryRow {
  month: string
  day_of_month: number
  major_category: string
  daily_total: number
}

interface CumulativeSpendingCardProps {
  data: DailyCategoryRow[]
  categories: string[]
  currentLabel: string
  previousLabel: string
  targetMonth: string
  // 月予算の水平線 (支出は負値で累積するため負の値を渡す)
  budgetLine?: number
}

export function CumulativeSpendingCard({
  data,
  categories,
  currentLabel,
  previousLabel,
  targetMonth,
  budgetLine,
}: CumulativeSpendingCardProps) {
  const [selected, setSelected] = useState(() => new Set(categories))

  const chartData = useMemo(() => {
    const filtered = data.filter((row) => selected.has(row.major_category))

    const currentMap = new Map<number, number>()
    const prevMap = new Map<number, number>()
    for (const row of filtered) {
      const map = row.month === targetMonth ? currentMap : prevMap
      map.set(row.day_of_month, (map.get(row.day_of_month) ?? 0) + row.daily_total)
    }

    const maxDay = Math.max(...[...currentMap.keys(), ...prevMap.keys(), 1])
    const result: { day: number; current: number | null; previous: number | null }[] = []
    let lastCurrent: number | null = null
    let lastPrevious: number | null = null

    for (let d = 1; d <= maxDay; d++) {
      const currentDaily = currentMap.get(d)
      const prevDaily = prevMap.get(d)

      if (currentDaily !== undefined) {
        lastCurrent = (lastCurrent ?? 0) + currentDaily
      }
      if (prevDaily !== undefined) {
        lastPrevious = (lastPrevious ?? 0) + prevDaily
      }

      result.push({
        day: d,
        current: lastCurrent,
        previous: lastPrevious,
      })
    }

    return result
  }, [data, selected, targetMonth])

  return (
    <Card>
      <CardHeader>
        <CardTitle>累積支出</CardTitle>
        <CategoryFilter
          categories={categories}
          selected={selected}
          onChange={setSelected}
        />
      </CardHeader>
      <CardContent>
        <CumulativeSpendingChart
          data={chartData}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          targetMonth={targetMonth}
          budgetLine={budgetLine}
        />
      </CardContent>
    </Card>
  )
}
