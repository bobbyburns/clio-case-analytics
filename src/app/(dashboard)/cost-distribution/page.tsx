import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { computeStats } from "@/lib/utils/stats"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { CostDistributionInteractive } from "@/components/CostDistributionInteractive"
import { AIChatAssistant } from "@/components/AIChatAssistant"

export const maxDuration = 60
export const revalidate = 300

export default async function CostDistributionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const t0 = Date.now()
  const matters = await fetchMatters(supabase, filters, true)
  console.log(`[cost-distribution] fetched ${matters.length} matters in ${Date.now() - t0}ms`)

  const activeMatters = matters.filter((m) => !m.disregarded)
  const billableAmounts = activeMatters
    .map((m) => m.total_billable ?? 0)
    .filter((v) => v > 0)
  const stats = computeStats(billableAmounts)

  const pageContext = `Page: Cost Distribution Analysis
Analyzing ${matters.length} total matters (${matters.filter((m) => m.disregarded).length} disregarded).
${billableAmounts.length} matters with billable amounts included in stats.

Statistical Summary:
- Count: ${formatNumber(stats.count)}
- Min: ${formatCurrency(stats.min)}
- P10: ${formatCurrency(stats.p10)}
- P25: ${formatCurrency(stats.p25)}
- Median (P50): ${formatCurrency(stats.p50)}
- P75: ${formatCurrency(stats.p75)}
- P90: ${formatCurrency(stats.p90)}
- Max: ${formatCurrency(stats.max)}
- Mean: ${formatCurrency(stats.mean)}
- Std Dev: ${formatCurrency(stats.stdDev)}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cost Distribution</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Analysis of total billable amounts across {matters.length} matters
        </p>
      </div>

      <CostDistributionInteractive matters={matters} pageContext={pageContext} />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
