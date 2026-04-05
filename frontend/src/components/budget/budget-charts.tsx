'use client'

import { Bar, XAxis, YAxis, Tooltip, Line, ComposedChart, Cell } from "recharts"
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "oklch(0.7 0.15 150)",
  "oklch(0.7 0.15 50)",
  "oklch(0.7 0.15 330)",
]

const categoryChartConfig = {
  total_amount: {
    label: "Amount",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

interface CumulativeData {
  day: number
  current: number | null
  previous: number | null
}

export function CumulativeSpendingChart({ data, currentLabel, previousLabel, targetMonth }: {
  data: CumulativeData[]
  currentLabel: string
  previousLabel: string
  targetMonth: string
}) {
  const config = {
    current: { label: currentLabel, color: "var(--chart-1)" },
    previous: { label: previousLabel, color: "var(--chart-3)" },
  } satisfies ChartConfig

  return (
    <ChartContainer config={config} className="h-[350px] w-full">
      <ComposedChart data={data}>
        <XAxis
          dataKey="day"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(val) => `${val}日`}
        />
        <YAxis
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(val) => `${(val / 10000).toFixed(0)}万`}
        />
        <Tooltip
          content={<ChartTooltipContent />}
          labelFormatter={(_value, payload) => {
            const day = payload?.[0]?.payload?.day
            const [y, m] = targetMonth.split('-').map(Number)
            return `${y}年${m}月${day}日`
          }}
          formatter={(value: number) => [`¥${Number(value).toLocaleString()}`, undefined]}
        />
        <Line
          dataKey="current"
          type="monotone"
          stroke="var(--color-current)"
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          dataKey="previous"
          type="monotone"
          stroke="var(--color-previous)"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ChartContainer>
  )
}

interface CategoryData {
  major_category: string
  total_amount: number
}

export function CategoryBreakdownChart({ data }: { data: CategoryData[] }) {
  return (
    <ChartContainer config={categoryChartConfig} className="h-[350px] w-full">
      <ComposedChart data={data} layout="vertical">
        <XAxis
          type="number"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(val) => `${(val / 10000).toFixed(0)}万`}
        />
        <YAxis
          type="category"
          dataKey="major_category"
          stroke="#888888"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={100}
        />
        <Tooltip
          content={<ChartTooltipContent />}
          formatter={(value: number) => [`¥${Number(value).toLocaleString()}`, undefined]}
        />
        <Bar dataKey="total_amount" radius={[0, 4, 4, 0]}>
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Bar>
      </ComposedChart>
    </ChartContainer>
  )
}
