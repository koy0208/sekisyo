'use client'

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DailyCategoryBarChart } from "@/components/budget/budget-charts"
import { CategoryFilter } from "@/components/budget/category-filter"

interface RawRow {
  date_key: string
  category: string
  daily_total: number
}

interface DailyCategoryCardProps {
  data: RawRow[]
  categories: string[]
  title: string
}

export function DailyCategoryCard({ data, categories, title }: DailyCategoryCardProps) {
  const [selected, setSelected] = useState(() => new Set(categories))

  const activeCategories = useMemo(
    () => categories.filter((c) => selected.has(c)),
    [categories, selected]
  )

  const chartData = useMemo(() => {
    const filtered = data.filter((row) => selected.has(row.category))
    const map = new Map<string, Record<string, number>>()

    for (const row of filtered) {
      if (!map.has(row.date_key)) {
        map.set(row.date_key, {})
      }
      const entry = map.get(row.date_key)!
      entry[row.category] = (entry[row.category] ?? 0) + row.daily_total
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date_key, cats]) => ({ date_key, ...cats }))
  }, [data, selected])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CategoryFilter
          categories={categories}
          selected={selected}
          onChange={setSelected}
        />
      </CardHeader>
      <CardContent>
        <DailyCategoryBarChart data={chartData} categories={activeCategories} />
      </CardContent>
    </Card>
  )
}
