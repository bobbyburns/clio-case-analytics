import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { KPICard } from "@/components/charts/KPICard"
import { CostDistributionSummary, CasesOverTime } from "@/components/charts/OverviewCharts"
import { median } from "@/lib/utils/stats"
import { histogram } from "@/lib/utils/stats"
import { formatCurrency, formatNumber } from "@/lib/utils/format"

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const matters = await fetchMatters(supabase, filters)

  const totalMatters = matters.length
  const closedMatters = matters.filter((m) => m.status === "Closed")
  const openMatters = matters.filter((m) => m.status === "Open")
  const totalClosed = closedMatters.length

  const billableAmounts = matters.map((m) => m.total_billable ?? 0).filter((v) => v > 0)
  const medianCost = median(billableAmounts)

  const durations = closedMatters
    .map((m) => m.duration_days)
    .filter((d): d is number => d != null && d > 0)
  const medianDurationMonths = durations.length > 0 ? median(durations) / 30.44 : 0

  const totalRevenue = matters.reduce((sum, m) => sum + (m.total_billable ?? 0), 0)

  // Cost distribution summary
  const costBins = histogram(billableAmounts, 12)
  const costDistData = costBins.map((b) => ({
    label: `$${Math.round(b.binStart / 1000)}k`,
    count: b.count,
  }))

  // Cases over time
  const quarterMap = new Map<string, number>()
  for (const m of matters) {
    if (m.open_date) {
      const d = new Date(m.open_date)
      const q = Math.ceil((d.getMonth() + 1) / 3)
      const key = `${d.getFullYear()} Q${q}`
      quarterMap.set(key, (quarterMap.get(key) ?? 0) + 1)
    }
  }
  const casesOverTime = [...quarterMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, count]) => ({ period, count }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Key metrics across {totalMatters} matters
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard label="Total Matters" value={formatNumber(totalMatters)} />
        <KPICard label="Total Closed" value={formatNumber(totalClosed)} />
        <KPICard label="Median Cost" value={formatCurrency(medianCost)} />
        <KPICard
          label="Median Duration"
          value={`${medianDurationMonths.toFixed(1)} mo`}
        />
        <KPICard label="Total Revenue" value={formatCurrency(totalRevenue)} />
        <KPICard label="Active Cases" value={formatNumber(openMatters.length)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CostDistributionSummary data={costDistData} />
        <CasesOverTime data={casesOverTime} />
      </div>
    </div>
  )
}
