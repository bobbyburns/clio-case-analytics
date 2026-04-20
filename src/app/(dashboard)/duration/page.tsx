import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { computeStats, histogram, mean } from "@/lib/utils/stats"
import { formatNumber, formatDuration, formatCurrency } from "@/lib/utils/format"
import { DurationHistogram, DurationVsCostScatter } from "@/components/charts/DurationCharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AIChatAssistant } from "@/components/AIChatAssistant"

function linearRegression(points: { x: number; y: number }[]) {
  if (points.length < 2) return { slope: 0, intercept: 0 }
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: mean(points.map((p) => p.y)) }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

export default async function DurationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const matters = await fetchMatters(supabase, filters)

  const closedMatters = matters.filter(
    (m) => m.status === "Closed" && m.duration_days != null && m.duration_days > 0
  )

  const durations = closedMatters.map((m) => m.duration_days!)
  const stats = computeStats(durations)
  const bins = histogram(durations, 20)

  // Scatter: duration vs cost
  const scatterData = closedMatters
    .filter((m) => (m.total_billable ?? 0) > 0)
    .map((m) => ({
      durationMonths: m.duration_days! / 30.44,
      cost: m.total_billable!,
      label: m.display_number,
    }))

  const regression = linearRegression(
    scatterData.map((d) => ({ x: d.durationMonths, y: d.cost }))
  )

  const pageContext = `Page: Duration Analysis
Analyzing case durations across ${closedMatters.length} closed matters.

Duration Statistics:
- Count: ${formatNumber(stats.count)}
- Min: ${formatDuration(stats.min)}
- P10: ${formatDuration(stats.p10)}
- P25: ${formatDuration(stats.p25)}
- Median (P50): ${formatDuration(stats.p50)}
- P75: ${formatDuration(stats.p75)}
- P90: ${formatDuration(stats.p90)}
- Max: ${formatDuration(stats.max)}
- Mean: ${formatDuration(stats.mean)}
- Std Dev: ${formatDuration(stats.stdDev)}

Duration vs Cost Scatter: ${scatterData.length} data points plotted.
Linear regression trend: for each additional month of duration, cost changes by approximately ${formatCurrency(regression.slope)} (slope=${regression.slope.toFixed(2)}, intercept=${formatCurrency(regression.intercept)}).
The histogram has ${bins.length} bins showing the distribution of case durations.`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Duration Analysis</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Case duration analysis across {closedMatters.length} closed matters
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DurationHistogram bins={bins} stats={stats} />
        <DurationVsCostScatter
          data={scatterData}
          trendSlope={regression.slope}
          trendIntercept={regression.intercept}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Duration Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <StatItem label="Count" value={formatNumber(stats.count)} />
            <StatItem label="Min" value={formatDuration(stats.min)} />
            <StatItem label="P10" value={formatDuration(stats.p10)} />
            <StatItem label="P25" value={formatDuration(stats.p25)} />
            <StatItem label="Median (P50)" value={formatDuration(stats.p50)} />
            <StatItem label="P75" value={formatDuration(stats.p75)} />
            <StatItem label="P90" value={formatDuration(stats.p90)} />
            <StatItem label="Max" value={formatDuration(stats.max)} />
            <StatItem label="Mean" value={formatDuration(stats.mean)} />
            <StatItem label="Std Dev" value={formatDuration(stats.stdDev)} />
          </div>
        </CardContent>
      </Card>

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  )
}
