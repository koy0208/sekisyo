'use client'

import { Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Line, ComposedChart } from "recharts"
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const chartConfig = {
  steps: {
    label: "Steps",
    color: "hsl(var(--chart-1))",
  },
  steps_ma: {
    label: "30d Moving Avg",
    color: "hsl(var(--chart-5))",
  },
  low_intensity_minutes: {
    label: "Low Intensity",
    color: "hsl(var(--chart-2))",
  },
  low_intensity_ma: {
    label: "30d Moving Avg",
    color: "hsl(var(--chart-5))",
  },
  total_sleep_hour: {
    label: "Sleep Hours",
    color: "hsl(var(--chart-3))",
  },
  total_sleep_hour_ma: {
    label: "30d Moving Avg",
    color: "hsl(var(--chart-5))",
  },
  active_zone_minutes: {
    label: "High Intensity",
    color: "hsl(var(--chart-4))",
  },
  active_zone_ma: {
    label: "30d Moving Avg",
    color: "hsl(var(--chart-5))",
  },
} satisfies ChartConfig

const MA_LINE_PROPS = {
  type: "monotone" as const,
  stroke: "hsl(var(--chart-5))",
  strokeWidth: 2,
  dot: false,
};

interface ChartData {
  date: string;
}

export function StepChart({ data }: { data: (ChartData & { steps: number; steps_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltipContent />} />
          <Bar dataKey="steps" fill="var(--color-steps)" radius={[4, 4, 0, 0]} />
          <Line dataKey="steps_ma" {...MA_LINE_PROPS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

export function LowIntensityChart({ data }: { data: (ChartData & { low_intensity_minutes: number; low_intensity_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltipContent />} />
          <Bar dataKey="low_intensity_minutes" fill="var(--color-low_intensity_minutes)" radius={[4, 4, 0, 0]} />
          <Line dataKey="low_intensity_ma" {...MA_LINE_PROPS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

export function SleepChart({ data }: { data: (ChartData & { total_sleep_hour: number; total_sleep_hour_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltipContent />} />
          <Bar dataKey="total_sleep_hour" fill="var(--color-total_sleep_hour)" radius={[4, 4, 0, 0]} />
          <Line dataKey="total_sleep_hour_ma" {...MA_LINE_PROPS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

export function HighIntensityChart({ data }: { data: (ChartData & { active_zone_minutes: number; active_zone_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltipContent />} />
          <Bar dataKey="active_zone_minutes" fill="var(--color-active_zone_minutes)" radius={[4, 4, 0, 0]} />
          <Line dataKey="active_zone_ma" {...MA_LINE_PROPS} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}
