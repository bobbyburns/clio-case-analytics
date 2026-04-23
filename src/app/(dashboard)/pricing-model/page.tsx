import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { PricingModelInteractive } from "@/components/PricingModelInteractive"
import { AIChatAssistant } from "@/components/AIChatAssistant"
import {
  buildScenarioMatters,
  computeBreakEvenPerMatter,
  monthlyFirmRevenue,
  revenuePredictability,
  runScenario,
  type ScenarioMatter,
} from "@/lib/utils/pricing"
import { parseClientsField } from "@/lib/utils/clients"
import { formatCurrency } from "@/lib/utils/format"
import type { Activity } from "@/lib/types"

const DEFAULT_RETAINER = 1500
const TOP_CLIENTS_COUNT = 10

export const maxDuration = 60

export default async function PricingModelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)

  const retainerParam = typeof params.retainer === "string" ? Number(params.retainer) : NaN
  const retainer = Number.isFinite(retainerParam) && retainerParam > 0 ? retainerParam : DEFAULT_RETAINER
  const excludeOutliers = params.excludeOutliers === "1"

  const t0 = Date.now()
  let matters: Awaited<ReturnType<typeof fetchMatters>>
  let activities: Activity[]
  try {
    matters = await fetchMatters(supabase, filters)
    console.log(`[pricing-model] fetched ${matters.length} matters in ${Date.now() - t0}ms`)
    const t1 = Date.now()
    activities = await fetchPricingActivities(
      supabase,
      matters.map((m) => m.unique_id),
      filters.dateFrom,
      filters.dateTo,
    )
    console.log(
      `[pricing-model] fetched ${activities.length} activities in ${Date.now() - t1}ms`,
    )
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error("[pricing-model] data fetch failed:", msg)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pricing Model Analysis</h1>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
          <h2 className="font-semibold text-rose-800">Data load failed</h2>
          <p className="mt-2 text-sm text-rose-700 font-mono whitespace-pre-wrap">{msg}</p>
          <p className="mt-3 text-xs text-rose-600">
            Try narrowing the filters (add a date range or select a specific case type) and reload.
          </p>
        </div>
      </div>
    )
  }

  const allScenarioMatters = buildScenarioMatters(matters, activities)

  // Scope = hourly matters only (exclude existing flat-fee per plan)
  const hourlyMatters = allScenarioMatters.filter(
    (m) => !m.isExistingFlatFee && m.totalBillable > 0,
  )
  const flatFeeCount = allScenarioMatters.filter((m) => m.isExistingFlatFee).length

  // Client value roll-ups — keyed by parseClientsField(matter.clients).key
  const clientLeaderboard = buildClientLeaderboard(hourlyMatters)
  const jointMatterPct =
    hourlyMatters.length > 0
      ? (hourlyMatters.filter((m) => parseClientsField(m.clients).isJoint).length /
          hourlyMatters.length) *
        100
      : 0

  // Monthly firm revenue (hourly) from activities, for predictability calculation
  const monthlyHourly = monthlyFirmRevenue(activities.filter((a) => !a.flat_rate))
  const monthlyHourlyEntries: Array<[string, number]> = Array.from(monthlyHourly.entries())

  // Top-N clients stacked area: group activities by (clientKey, YYYY-MM)
  const { monthlyTopClientsData, topClientKeys } = buildTopClientMonthlyData(
    hourlyMatters,
    activities,
  )

  // AI context — server-computed summary at the URL-default retainer
  const defaultMattersForContext = excludeOutliers
    ? excludeTopByBillable(hourlyMatters, 0.05)
    : hourlyMatters
  const defaultResults = runScenario(defaultMattersForContext, retainer)
  const totalActual = defaultMattersForContext.reduce((s, m) => s + m.totalBillable, 0)
  const totalHypothetical = defaultResults.reduce((s, r) => s + r.hypotheticalRevenue, 0)
  const winners = defaultResults.filter((r) => r.isWinner).length
  const losers = defaultResults.filter((r) => r.delta < 0).length
  const breakEven = computeBreakEvenPerMatter(defaultMattersForContext)
  const predictability = revenuePredictability(
    monthlyHourly,
    defaultMattersForContext,
    retainer,
  )

  const pageContext = `Page: Pricing Model Analysis
Scenario: flat monthly retainer of ${formatCurrency(retainer)}.
In-scope: ${defaultMattersForContext.length} hourly matters (${flatFeeCount} flat-fee matters excluded, ${excludeOutliers ? "top 5% billable outliers excluded" : "all outliers included"}).
Actual hourly revenue: ${formatCurrency(totalActual)}
Hypothetical retainer revenue: ${formatCurrency(totalHypothetical)}
Firm revenue delta: ${formatCurrency(totalHypothetical - totalActual)}
Winners: ${winners} matters would earn more under retainer; Losers: ${losers} would earn less.

Break-even values:
- Firm-level: ${formatCurrency(breakEven.firmLevel)} (retainer at which total revenue is unchanged)
- Per-matter median: ${formatCurrency(breakEven.perMatterMedian)} (retainer at which half of matters earn more)
- Per-matter mean: ${formatCurrency(breakEven.perMatterMean)} (mean monthly revenue density — outlier-sensitive)

Revenue predictability:
- Current hourly monthly revenue: mean ${formatCurrency(predictability.hourlyMean)}, std dev ${formatCurrency(predictability.hourlyStdDev)}
- Retainer monthly revenue: mean ${formatCurrency(predictability.scenarioMean)}, std dev ${formatCurrency(predictability.scenarioStdDev)}

Top 5 clients by avg monthly value: ${clientLeaderboard
    .slice(0, 5)
    .map((c) => `${c.display} (${formatCurrency(c.avgMonthlyValue)}/mo, ${c.matterCount} matter(s))`)
    .join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing Model Analysis</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Model what a flat monthly retainer would have meant for firm revenue. Active months
          are computed from first-to-last activity date per matter, floored to one month.
          Existing flat-fee matters are excluded from the hourly baseline.
        </p>
      </div>

      <PricingModelInteractive
        scenarioMatters={hourlyMatters}
        monthlyHourlyEntries={monthlyHourlyEntries}
        monthlyTopClientsData={monthlyTopClientsData}
        topClientKeys={topClientKeys}
        clientLeaderboard={clientLeaderboard}
        flatFeeCount={flatFeeCount}
        totalInScopeBeforeOutliers={hourlyMatters.length}
        jointMatterPct={jointMatterPct}
        initialRetainer={retainer}
        initialExcludeOutliers={excludeOutliers}
      />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}

/** Fetch only the activity columns this page needs, scoped to the supplied matter IDs.
 *  Chunks the IN() clause to stay under PostgREST URL limits and avoids full-table scans. */
async function fetchPricingActivities(
  supabase: SupabaseClient,
  matterIds: string[],
  dateFrom: string | null,
  dateTo: string | null,
): Promise<Activity[]> {
  if (matterIds.length === 0) return []
  const COLS =
    "matter_unique_id,activity_date,billable_amount,flat_rate,hours,rate,type,user_name,description,bill_state,nonbillable_amount"
  const ID_CHUNK = 100
  const PAGE = 1000
  const all: Activity[] = []

  for (let i = 0; i < matterIds.length; i += ID_CHUNK) {
    const idChunk = matterIds.slice(i, i + ID_CHUNK)
    let offset = 0
    while (true) {
      let q = supabase.from("clio_activities").select(COLS).in("matter_unique_id", idChunk)
      if (dateFrom) q = q.gte("activity_date", dateFrom)
      if (dateTo) q = q.lte("activity_date", dateTo)
      const { data, error } = await q
        .order("activity_date", { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...(data as unknown as Activity[]))
      if (data.length < PAGE) break
      offset += PAGE
    }
  }
  return all
}

function excludeTopByBillable(matters: ScenarioMatter[], pct: number): ScenarioMatter[] {
  const sorted = [...matters].sort((a, b) => b.totalBillable - a.totalBillable)
  const cutoff = Math.max(1, Math.floor(sorted.length * pct))
  const excludeIds = new Set(sorted.slice(0, cutoff).map((m) => m.unique_id))
  return matters.filter((m) => !excludeIds.has(m.unique_id))
}

interface ClientRollup {
  clientKey: string
  display: string
  isJoint: boolean
  totalRevenue: number
  monthsActive: number
  avgMonthlyValue: number
  matterCount: number
}

function buildClientLeaderboard(matters: ScenarioMatter[]): ClientRollup[] {
  const byClient = new Map<
    string,
    {
      display: string
      isJoint: boolean
      totalRevenue: number
      monthsActive: number
      matterCount: number
    }
  >()

  for (const m of matters) {
    const parsed = parseClientsField(m.clients)
    const existing = byClient.get(parsed.key)
    if (existing) {
      existing.totalRevenue += m.totalBillable
      existing.monthsActive += m.activeMonths
      existing.matterCount += 1
    } else {
      byClient.set(parsed.key, {
        display: parsed.display,
        isJoint: parsed.isJoint,
        totalRevenue: m.totalBillable,
        monthsActive: m.activeMonths,
        matterCount: 1,
      })
    }
  }

  return Array.from(byClient.entries())
    .map(([clientKey, v]) => ({
      clientKey,
      display: v.display,
      isJoint: v.isJoint,
      totalRevenue: v.totalRevenue,
      monthsActive: v.monthsActive,
      avgMonthlyValue: v.monthsActive > 0 ? v.totalRevenue / v.monthsActive : 0,
      matterCount: v.matterCount,
    }))
    .sort((a, b) => b.avgMonthlyValue - a.avgMonthlyValue)
}

function buildTopClientMonthlyData(
  matters: ScenarioMatter[],
  activities: import("@/lib/types").Activity[],
): {
  monthlyTopClientsData: Array<Record<string, string | number>>
  topClientKeys: string[]
} {
  // Map matter unique_id -> client display (for top-N labeling)
  const matterToDisplay = new Map<string, { key: string; display: string }>()
  for (const m of matters) {
    const parsed = parseClientsField(m.clients)
    matterToDisplay.set(m.unique_id, { key: parsed.key, display: parsed.display })
  }

  // Identify top-N clients by total revenue
  const revenueByClientKey = new Map<string, { display: string; total: number }>()
  for (const m of matters) {
    const info = matterToDisplay.get(m.unique_id)!
    const existing = revenueByClientKey.get(info.key)
    if (existing) existing.total += m.totalBillable
    else revenueByClientKey.set(info.key, { display: info.display, total: m.totalBillable })
  }
  const topClients = Array.from(revenueByClientKey.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, TOP_CLIENTS_COUNT)
  const topClientKeySet = new Set(topClients.map(([key]) => key))
  const keyToDisplay = new Map<string, string>(
    topClients.map(([key, v]) => [key, v.display]),
  )

  // Aggregate activities: (YYYY-MM, clientDisplay-or-"Other") -> sum
  const monthly = new Map<string, Map<string, number>>()
  for (const a of activities) {
    if (!a.activity_date || (a.billable_amount ?? 0) <= 0 || a.flat_rate) continue
    const mid = String(a.matter_unique_id ?? "")
    const info = matterToDisplay.get(mid)
    if (!info) continue // activity on a flat-fee or out-of-scope matter
    const column = topClientKeySet.has(info.key) ? keyToDisplay.get(info.key)! : "Other"
    const ym = a.activity_date.slice(0, 7)
    if (!monthly.has(ym)) monthly.set(ym, new Map())
    const inner = monthly.get(ym)!
    inner.set(column, (inner.get(column) ?? 0) + (a.billable_amount ?? 0))
  }

  const months = Array.from(monthly.keys()).sort()
  const topDisplays = topClients.map(([, v]) => v.display)
  const allColumns = [...topDisplays, "Other"]

  const data = months.map((ym) => {
    const row: Record<string, string | number> = { month: ym }
    const inner = monthly.get(ym)
    for (const col of allColumns) {
      row[col] = Math.round(inner?.get(col) ?? 0)
    }
    return row
  })

  return { monthlyTopClientsData: data, topClientKeys: allColumns }
}
