import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown } from "lucide-react"

interface StatsCardProps {
  title: string
  value: string | number
  unit?: string
  // 値がいつ時点のものか(例: "7/4")。「今日の値」と誤読させないため必ず日付を明示する
  asOf?: string
  description?: string
  icon?: React.ReactNode
  delta?: number | null
  deltaLabel?: string
}

export function StatsCard({ title, value, unit, asOf, description, icon, delta, deltaLabel }: StatsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
          {asOf && <span className="ml-1.5 font-normal text-muted-foreground">({asOf})</span>}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </div>
        {delta != null && (
          <p className={`flex items-center gap-1 text-xs ${delta > 0 ? "text-destructive" : "text-emerald-600"}`}>
            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
            {deltaLabel && <span className="text-muted-foreground ml-1">{deltaLabel}</span>}
          </p>
        )}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  )
}
