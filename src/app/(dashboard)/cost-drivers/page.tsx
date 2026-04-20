import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { median } from "@/lib/utils/stats"
import { formatCurrency } from "@/lib/utils/format"
import {
  ChildrenCostChart,
  CountyCostChart,
  OpposingCounselCostChart,
  CaseTypeCostChart,
  AttorneyCostChart,
  RetainerCostChart,
} from "@/components/charts/CostDriversCharts"
import { AIChatAssistant } from "@/components/AIChatAssistant"

function groupByMedianCost(
  matters: { key: string; cost: number }[]
): { name: string; medianCost: number; count: number }[] {
  const groups = new Map<string, number[]>()
  for (const m of matters) {
    if (!groups.has(m.key)) groups.set(m.key, [])
    groups.get(m.key)!.push(m.cost)
  }
  return [...groups.entries()]
    .map(([name, costs]) => ({
      name,
      medianCost: median(costs),
      count: costs.length,
    }))
    .sort((a, b) => b.medianCost - a.medianCost)
}

export default async function CostDriversPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const matters = await fetchMatters(supabase, filters)

  const withCost = matters.filter((m) => (m.total_billable ?? 0) > 0)

  // By number of children
  const childrenData = groupByMedianCost(
    withCost.map((m) => ({
      key:
        m.number_of_children == null
          ? "Unknown"
          : m.number_of_children >= 3
            ? "3+"
            : String(m.number_of_children),
      cost: m.total_billable ?? 0,
    }))
  )

  // By county (top 10)
  const countyData = groupByMedianCost(
    withCost
      .filter((m) => m.county)
      .map((m) => ({ key: m.county!, cost: m.total_billable ?? 0 }))
  ).slice(0, 10)

  // By opposing counsel
  const opposingData = groupByMedianCost(
    withCost.map((m) => ({
      key: m.has_opposing_counsel ? "Yes" : "No",
      cost: m.total_billable ?? 0,
    }))
  )

  // By case type (top 10)
  const caseTypeData = groupByMedianCost(
    withCost
      .filter((m) => m.case_type)
      .map((m) => ({ key: m.case_type!, cost: m.total_billable ?? 0 }))
  ).slice(0, 10)

  // By responsible attorney
  const attorneyData = groupByMedianCost(
    withCost
      .filter((m) => m.responsible_attorney)
      .map((m) => ({ key: m.responsible_attorney!, cost: m.total_billable ?? 0 }))
  )

  // By retainer type
  const retainerData = groupByMedianCost(
    withCost
      .filter((m) => m.retainer_type)
      .map((m) => ({ key: m.retainer_type!, cost: m.total_billable ?? 0 }))
  )

  const pageContext = `Page: Cost Drivers Analysis
Analyzing median costs broken down by key case attributes across ${withCost.length} matters with billable amounts.

By Number of Children: ${childrenData.map((d) => `${d.name} children: ${formatCurrency(d.medianCost)} median (${d.count} cases)`).join("; ")}

By Opposing Counsel: ${opposingData.map((d) => `${d.name}: ${formatCurrency(d.medianCost)} median (${d.count} cases)`).join("; ")}

Top Counties by Median Cost: ${countyData.map((d) => `${d.name}: ${formatCurrency(d.medianCost)} (${d.count} cases)`).join("; ")}

Top Case Types by Median Cost: ${caseTypeData.map((d) => `${d.name}: ${formatCurrency(d.medianCost)} (${d.count} cases)`).join("; ")}

By Attorney: ${attorneyData.map((d) => `${d.name}: ${formatCurrency(d.medianCost)} (${d.count} cases)`).join("; ")}

By Retainer Type: ${retainerData.map((d) => `${d.name}: ${formatCurrency(d.medianCost)} (${d.count} cases)`).join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cost Drivers</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Median cost broken down by key case attributes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChildrenCostChart data={childrenData} />
        <OpposingCounselCostChart data={opposingData} />
        <CountyCostChart data={countyData} />
        <CaseTypeCostChart data={caseTypeData} />
        <AttorneyCostChart data={attorneyData} />
        <RetainerCostChart data={retainerData} />
      </div>

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
