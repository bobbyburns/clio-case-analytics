import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { mean } from "@/lib/utils/stats"
import { formatCurrency, formatNumber, formatDuration } from "@/lib/utils/format"
import { RevenueByAttorney } from "@/components/charts/AttorneyCharts"
import { AttorneyTableClient } from "@/components/charts/AttorneyTable"
import { AIChatAssistant } from "@/components/AIChatAssistant"

export const maxDuration = 60
export const revalidate = 300

export default async function AttorneysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const t0 = Date.now()
  const matters = await fetchMatters(supabase, filters)
  console.log(`[attorneys] fetched ${matters.length} matters in ${Date.now() - t0}ms`)

  // Group by attorney
  const attorneyMap = new Map<
    string,
    {
      cases: number
      revenue: number
      costs: number[]
      durations: number[]
    }
  >()

  for (const m of matters) {
    const atty = m.responsible_attorney ?? "Unassigned"
    if (!attorneyMap.has(atty)) {
      attorneyMap.set(atty, { cases: 0, revenue: 0, costs: [], durations: [] })
    }
    const entry = attorneyMap.get(atty)!
    entry.cases++
    entry.revenue += m.total_billable ?? 0
    if ((m.total_billable ?? 0) > 0) {
      entry.costs.push(m.total_billable!)
    }
    if (m.duration_days != null && m.duration_days > 0) {
      entry.durations.push(m.duration_days)
    }
  }

  const tableData = [...attorneyMap.entries()]
    .map(([name, data]) => ({
      name,
      caseCount: data.cases,
      totalRevenue: Math.round(data.revenue),
      avgCost: Math.round(mean(data.costs)),
      avgDuration: Math.round(mean(data.durations)),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  const chartData = tableData.map((d) => ({
    name: d.name,
    revenue: d.totalRevenue,
  }))

  const pageContext = `Page: Attorney Performance
Analyzing performance metrics across ${tableData.length} attorneys for ${formatNumber(matters.length)} total matters.

Attorney Breakdown (sorted by revenue):
${tableData.map((d) => `- ${d.name}: ${d.caseCount} cases, ${formatCurrency(d.totalRevenue)} total revenue, ${formatCurrency(d.avgCost)} avg cost/case, ${formatDuration(d.avgDuration)} avg duration`).join("\n")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Attorneys</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Performance metrics by responsible attorney
        </p>
      </div>

      <RevenueByAttorney data={chartData} />
      <AttorneyTableClient data={tableData} />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
