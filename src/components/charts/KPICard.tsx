import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface KPICardProps {
  label: string
  value: string | number
  trend?: string
  trendDirection?: "up" | "down" | "neutral"
  className?: string
}

export function KPICard({ label, value, trend, trendDirection = "neutral", className }: KPICardProps) {
  const trendColor =
    trendDirection === "up"
      ? "text-emerald-600"
      : trendDirection === "down"
        ? "text-red-600"
        : "text-slate-500"

  return (
    <Card className={className}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {trend && (
          <p className={`text-xs mt-1 ${trendColor}`}>{trend}</p>
        )}
      </CardContent>
    </Card>
  )
}
