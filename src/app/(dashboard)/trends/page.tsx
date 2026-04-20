import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { mean } from "@/lib/utils/stats"
import { formatCurrency } from "@/lib/utils/format"
import {
  CasesPerQuarter,
  AvgCostPerQuarter,
  RevenuePerQuarter,
} from "@/components/charts/TrendsCharts"
import { AIChatAssistant } from "@/components/AIChatAssistant"

function toQuarter(dateStr: string): string {
  const d = new Date(dateStr)
  const q = Math.ceil((d.getMonth() + 1) / 3)
  return `${d.getFullYear()} Q${q}`
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const matters = await fetchMatters(supabase, filters)

  // Cases per quarter
  const openedMap = new Map<string, number>()
  const closedMap = new Map<string, number>()
  const costMap = new Map<string, number[]>()
  const revenueMap = new Map<string, number>()

  for (const m of matters) {
    if (m.open_date) {
      const q = toQuarter(m.open_date)
      openedMap.set(q, (openedMap.get(q) ?? 0) + 1)
      if (!costMap.has(q)) costMap.set(q, [])
      if ((m.total_billable ?? 0) > 0) {
        costMap.get(q)!.push(m.total_billable!)
      }
      revenueMap.set(q, (revenueMap.get(q) ?? 0) + (m.total_billable ?? 0))
    }
    if (m.close_date) {
      const q = toQuarter(m.close_date)
      closedMap.set(q, (closedMap.get(q) ?? 0) + 1)
    }
  }

  const allQuarters = [
    ...new Set([...openedMap.keys(), ...closedMap.keys()]),
  ].sort()

  const casesData = allQuarters.map((period) => ({
    period,
    opened: openedMap.get(period) ?? 0,
    closed: closedMap.get(period) ?? 0,
  }))

  const costData = allQuarters
    .filter((q) => (costMap.get(q)?.length ?? 0) > 0)
    .map((period) => ({
      period,
      avgCost: Math.round(mean(costMap.get(period) ?? [])),
    }))

  const revenueData = allQuarters.map((period) => ({
    period,
    revenue: Math.round(revenueMap.get(period) ?? 0),
  }))

  const pageContext = `Page: Quarterly Trends
Tracking trends across ${matters.length} matters over ${allQuarters.length} quarters.

Cases Opened/Closed per Quarter: ${casesData.map((d) => `${d.period}: ${d.opened} opened, ${d.closed} closed`).join("; ")}

Average Cost per Quarter: ${costData.map((d) => `${d.period}: ${formatCurrency(d.avgCost)}`).join("; ")}

Revenue per Quarter: ${revenueData.map((d) => `${d.period}: ${formatCurrency(d.revenue)}`).join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Trends</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Quarterly trends across case volume, costs, and revenue
        </p>
      </div>

      <CasesPerQuarter data={casesData} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AvgCostPerQuarter data={costData} />
        <RevenuePerQuarter data={revenueData} />
      </div>

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
