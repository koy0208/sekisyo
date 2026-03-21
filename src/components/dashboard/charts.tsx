'use client'

import { Area, Bar, XAxis, YAxis, Tooltip, Line, ComposedChart } from "recharts"
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const chartConfig = {
  steps: {
    label: "Steps",
    color: "var(--chart-1)",
  },
  steps_ma: {
    label: "30d Moving Avg",
    color: "hsl(0 84.2% 60.2%)", // 赤っぽい色
  },
  low_intensity_minutes: {
    label: "Low Intensity",
    color: "var(--chart-1)",
  },
  low_intensity_ma: {
    label: "30d Moving Avg",
    color: "hsl(0 84.2% 60.2%)", // 赤っぽい色
  },
  total_sleep_hour: {
    label: "Sleep Hours",
    color: "var(--chart-1)",
  },
  total_sleep_hour_ma: {
    label: "30d Moving Avg",
    color: "hsl(0 84.2% 60.2%)", // 赤っぽい色
  },
  sleep_range: {
    label: "Sleep Schedule",
    color: "var(--chart-1)",
  },
  active_zone_minutes: {
    label: "High Intensity",
    color: "var(--chart-1)",
  },
  active_zone_ma: {
    label: "30d Moving Avg",
    color: "hsl(0 84.2% 60.2%)", // 赤っぽい色
  },
} satisfies ChartConfig

const MA_LINE_PROPS = {
  type: "monotone" as const,
  stroke: "hsl(0 84.2% 60.2%)", // 赤っぽい色
  strokeWidth: 2,
  dot: false,
};

interface ChartData {
  date: string;
}

export function StepChart({ data }: { data: (ChartData & { steps: number; steps_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ComposedChart data={data}>
        <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="steps" fill="var(--color-steps)" radius={[4, 4, 0, 0]} />
        <Line dataKey="steps_ma" {...MA_LINE_PROPS} />
      </ComposedChart>
    </ChartContainer>
  )
}

export function LowIntensityChart({ data }: { data: (ChartData & { low_intensity_minutes: number; low_intensity_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ComposedChart data={data}>
        <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="low_intensity_minutes" fill="var(--color-low_intensity_minutes)" radius={[4, 4, 0, 0]} />
        <Line dataKey="low_intensity_ma" {...MA_LINE_PROPS} />
      </ComposedChart>
    </ChartContainer>
  )
}

export function SleepChart({ data }: { data: (ChartData & { total_sleep_hour: number; total_sleep_hour_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ComposedChart data={data}>
        <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="total_sleep_hour" fill="var(--color-total_sleep_hour)" radius={[4, 4, 0, 0]} />
        <Line dataKey="total_sleep_hour_ma" {...MA_LINE_PROPS} />
      </ComposedChart>
    </ChartContainer>
  )
}

export function SleepScheduleChart({ data }: { data: (ChartData & { start_time: string; end_time: string })[] }) {
  const processedData = data.map(d => {
    const dateStr = d.date;
    const start = new Date(d.start_time);
    const end = new Date(d.end_time);
    
    // Calculate hours from midnight of the 'date'
    // If date is "2024-11-29", midnight is 2024-11-29T00:00:00
    const midnight = new Date(`${dateStr}T00:00:00`);
    
    let startOffset = (start.getTime() - midnight.getTime()) / (1000 * 60 * 60);
    let endOffset = (end.getTime() - midnight.getTime()) / (1000 * 60 * 60);

    // If start is more than 18 hours after midnight, it's probably for the previous day's sleep ending on this date
    if (startOffset > 18) {
      startOffset -= 24;
      endOffset -= 24;
    } else if (startOffset < -12) {
      startOffset += 24;
      endOffset += 24;
    }
    
    return {
      ...d,
      range: [startOffset, endOffset],
      startLabel: start.toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' }),
      endLabel: end.toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' }),
    };
  });

  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ComposedChart data={processedData}>
        <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis 
          domain={[12, -4]} // Inverted: 12:00 at bottom, 20:00 at top
          ticks={[-4, -2, 0, 2, 4, 6, 8, 10, 12]}
          stroke="#888888" 
          fontSize={12} 
          tickLine={false} 
          axisLine={false} 
          tickFormatter={(val) => {
            const h = (val + 24) % 24;
            return `${h.toString().padStart(2, '0')}:00`;
          }}
        />
        <Tooltip 
          content={<ChartTooltipContent />} 
          formatter={(value: number | [number, number], name: string, item: { payload?: { startLabel: string; endLabel: string; } }) => {
            if (name === "range" && item.payload) {
              return [`${item.payload.startLabel} - ${item.payload.endLabel}`, "Sleep Interval"];
            }
            return [value, name];
          }}
        />
        <Area dataKey="range" fill="var(--color-total_sleep_hour)" stroke="var(--color-total_sleep_hour)" />
      </ComposedChart>
    </ChartContainer>
  )
}

export function HighIntensityChart({ data }: { data: (ChartData & { active_zone_minutes: number; active_zone_ma: number | null })[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[350px] w-full">
      <ComposedChart data={data}>
        <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip content={<ChartTooltipContent />} />
        <Bar dataKey="active_zone_minutes" fill="var(--color-active_zone_minutes)" radius={[4, 4, 0, 0]} />
        <Line dataKey="active_zone_ma" {...MA_LINE_PROPS} />
      </ComposedChart>
    </ChartContainer>
  )
}
