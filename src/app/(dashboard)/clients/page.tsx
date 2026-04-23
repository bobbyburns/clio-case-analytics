import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters, fetchActivitiesForMatters } from "@/lib/queries"
import { ClientsInteractive } from "@/components/ClientsInteractive"
import { AIChatAssistant } from "@/components/AIChatAssistant"
import { parseClientsField } from "@/lib/utils/clients"
import { formatCurrency } from "@/lib/utils/format"
import type { Activity } from "@/lib/types"

export const maxDuration = 60
export const revalidate = 300

const DAYS_PER_MONTH = 30.44
const DEFAULT_RETAINER = 1500

export type EngagementType =
  | "ongoing" // span ≥ 30 days
  | "short-burst" // 2–29 days, ≥2 activities
  | "single-activity" // activity_count == 1 but not legacy
  | "flat-fee" // majority of billable revenue comes from flat_rate activities
  | "legacy-migration" // Xero balance-forward activities from 2016-11-06

export interface ClientMatter {
  unique_id: string
  display_number: string
  mapped_category: string | null
  case_type: string | null
  total_billable: number
  activity_count: number | null
  open_date: string | null
  close_date: string | null
  firstActivityDate: string | null
  lastActivityDate: string | null
  hasFlatRateActivity: boolean
  hasLegacyMigration: boolean
}

export interface ClientRow {
  clientKey: string
  display: string
  isJoint: boolean
  totalBillable: number
  monthsActive: number
  avgPerMonth: number
  matterCount: number
  firstActivityDate: string | null
  lastActivityDate: string | null
  engagementType: EngagementType
  matters: ClientMatter[]
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)

  const retainerParam = typeof params.retainer === "string" ? Number(params.retainer) : NaN
  const retainer =
    Number.isFinite(retainerParam) && retainerParam > 0
      ? Math.min(10000, retainerParam)
      : DEFAULT_RETAINER
  const firstFrom = typeof params.firstFrom === "string" ? params.firstFrom : ""
  const firstTo = typeof params.firstTo === "string" ? params.firstTo : ""
  const typesParam = typeof params.types === "string" ? params.types : ""
  const initialTypes = typesParam ? typesParam.split(",").filter(Boolean) : []

  let matters: Awaited<ReturnType<typeof fetchMatters>>
  let activities: Activity[]
  try {
    matters = await fetchMatters(supabase, filters)
    activities = await fetchActivitiesForMatters(
      supabase,
      matters.map((m) => m.unique_id),
      { dateFrom: filters.dateFrom, dateTo: filters.dateTo },
    )
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
          <h2 className="font-semibold text-rose-800">Data load failed</h2>
          <p className="mt-2 text-sm text-rose-700 font-mono whitespace-pre-wrap">{msg}</p>
        </div>
      </div>
    )
  }

  // Per-matter activity metadata: dates + flat-rate share + legacy-migration detection
  interface MatterActStats {
    dates: string[]
    totalBillable: number
    flatRateBillable: number
    legacyBillable: number // Xero 2016-11-06 balance-forwards
  }
  const actStatsByMatter = new Map<string, MatterActStats>()
  for (const a of activities) {
    if (!a.matter_unique_id) continue
    const key = String(a.matter_unique_id)
    let s = actStatsByMatter.get(key)
    if (!s) {
      s = { dates: [], totalBillable: 0, flatRateBillable: 0, legacyBillable: 0 }
      actStatsByMatter.set(key, s)
    }
    if (a.activity_date) s.dates.push(a.activity_date)
    const amt = a.billable_amount ?? 0
    s.totalBillable += amt
    if (a.flat_rate) s.flatRateBillable += amt
    if (
      a.activity_date === "2016-11-06" &&
      (a.description || "").toLowerCase().includes("xero")
    ) {
      s.legacyBillable += amt
    }
  }

  // Aggregate per client, keeping the per-matter structure so the UI can drill in.
  const byClient = new Map<
    string,
    {
      display: string
      isJoint: boolean
      totalBillable: number
      matterCount: number
      allActivityDates: string[]
      flatRateBillable: number
      legacyBillable: number
      matters: ClientMatter[]
    }
  >()

  for (const m of matters) {
    const parsed = parseClientsField(m.clients)
    const billable = m.total_billable ?? 0
    const stats = actStatsByMatter.get(m.unique_id)
    const dates = stats?.dates ?? []
    const sortedDates = [...dates].sort()
    const firstDate = sortedDates[0] ?? null
    const lastDate = sortedDates[sortedDates.length - 1] ?? null

    const clientMatter: ClientMatter = {
      unique_id: m.unique_id,
      display_number: m.display_number,
      mapped_category: m.mapped_category,
      case_type: m.case_type,
      total_billable: billable,
      activity_count: m.activity_count,
      open_date: m.open_date,
      close_date: m.close_date,
      firstActivityDate: firstDate,
      lastActivityDate: lastDate,
      hasFlatRateActivity: (stats?.flatRateBillable ?? 0) > 0,
      hasLegacyMigration: (stats?.legacyBillable ?? 0) > 0,
    }

    const existing = byClient.get(parsed.key)
    if (existing) {
      existing.totalBillable += billable
      existing.matterCount += 1
      existing.allActivityDates.push(...dates)
      existing.flatRateBillable += stats?.flatRateBillable ?? 0
      existing.legacyBillable += stats?.legacyBillable ?? 0
      existing.matters.push(clientMatter)
    } else {
      byClient.set(parsed.key, {
        display: parsed.display,
        isJoint: parsed.isJoint,
        totalBillable: billable,
        matterCount: 1,
        allActivityDates: [...dates],
        flatRateBillable: stats?.flatRateBillable ?? 0,
        legacyBillable: stats?.legacyBillable ?? 0,
        matters: [clientMatter],
      })
    }
  }

  const rows: ClientRow[] = []
  for (const [clientKey, v] of byClient.entries()) {
    let firstDate: string | null = null
    let lastDate: string | null = null
    let monthsActive = 0
    let spanDays = 0
    if (v.allActivityDates.length > 0) {
      const sorted = [...v.allActivityDates].sort()
      firstDate = sorted[0]
      lastDate = sorted[sorted.length - 1]
      spanDays =
        (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)
      monthsActive = Math.max(0, spanDays / DAYS_PER_MONTH)
    }

    // Engagement classification:
    // - legacy-migration: majority of revenue is from Xero 2016-11-06 balance-forwards
    // - flat-fee: ≥70% of revenue is from flat_rate activities
    // - single-activity: only 1 activity
    // - short-burst: span 2–29 days with multiple activities (OP/DV/quick-turn)
    // - ongoing: everything else (span ≥ 30 days OR fallback)
    let engagementType: EngagementType
    const hasRevenue = v.totalBillable > 0
    const legacyShare = hasRevenue ? v.legacyBillable / v.totalBillable : 0
    const flatShare = hasRevenue ? v.flatRateBillable / v.totalBillable : 0
    if (legacyShare >= 0.5) {
      engagementType = "legacy-migration"
    } else if (flatShare >= 0.7) {
      engagementType = "flat-fee"
    } else if (v.allActivityDates.length <= 1) {
      engagementType = "single-activity"
    } else if (spanDays < 30) {
      engagementType = "short-burst"
    } else {
      engagementType = "ongoing"
    }

    rows.push({
      clientKey,
      display: v.display,
      isJoint: v.isJoint,
      totalBillable: v.totalBillable,
      monthsActive,
      avgPerMonth: monthsActive > 0 ? v.totalBillable / monthsActive : 0,
      matterCount: v.matterCount,
      firstActivityDate: firstDate,
      lastActivityDate: lastDate,
      engagementType,
      matters: v.matters,
    })
  }

  // Descending by total billable by default
  rows.sort((a, b) => b.totalBillable - a.totalBillable)

  // Firm-wide averages (across the filtered list)
  const clientCount = rows.length
  const totalRevenue = rows.reduce((s, r) => s + r.totalBillable, 0)
  const totalMatters = rows.reduce((s, r) => s + r.matterCount, 0)
  const avgRevenuePerClient = clientCount > 0 ? totalRevenue / clientCount : 0
  const activeRows = rows.filter((r) => r.monthsActive > 0)
  const avgMonthsActive =
    activeRows.length > 0
      ? activeRows.reduce((s, r) => s + r.monthsActive, 0) / activeRows.length
      : 0
  const avgPerMonthMean =
    activeRows.length > 0
      ? activeRows.reduce((s, r) => s + r.avgPerMonth, 0) / activeRows.length
      : 0
  const totalMonthsAll = rows.reduce((s, r) => s + r.monthsActive, 0)
  const weightedAvgPerMonth = totalMonthsAll > 0 ? totalRevenue / totalMonthsAll : 0

  // Default-scenario summary at the URL retainer (just for the AI page context —
  // the interactive UI recomputes client-side as the slider moves).
  let scenarioWinners = 0
  let scenarioLosers = 0
  let scenarioHypothetical = 0
  let scenarioRevenueAtRisk = 0
  let scenarioRevenueCaptured = 0
  for (const r of rows) {
    const activeMonthsCeil = Math.max(1, Math.ceil(r.monthsActive))
    const hypothetical = activeMonthsCeil * retainer
    const delta = hypothetical - r.totalBillable
    scenarioHypothetical += hypothetical
    if (delta > 0) {
      scenarioWinners++
      scenarioRevenueCaptured += delta
    } else if (delta < 0) {
      scenarioLosers++
      scenarioRevenueAtRisk += -delta
    }
  }
  const scenarioDelta = scenarioHypothetical - totalRevenue
  const firmBreakEven = totalMonthsAll > 0 ? totalRevenue / totalMonthsAll : 0

  const pageContext = `Page: Clients
${clientCount} clients across ${totalMatters} matters, total revenue ${formatCurrency(totalRevenue)}.
Average revenue per client: ${formatCurrency(avgRevenuePerClient)}
Average months active per client: ${avgMonthsActive.toFixed(1)} months
Average revenue per active month (mean of per-client ratios): ${formatCurrency(avgPerMonthMean)}
Weighted average ($ per active month across the firm): ${formatCurrency(weightedAvgPerMonth)}

Retainer scenario at ${formatCurrency(retainer)}/month (active months floored to 1 per client):
- Revenue under retainer: ${formatCurrency(scenarioHypothetical)} vs. ${formatCurrency(totalRevenue)} actual hourly
- Firm revenue delta: ${formatCurrency(scenarioDelta)}
- Winners (would earn more under retainer): ${scenarioWinners}
- Losers (would earn less under retainer): ${scenarioLosers}
- Revenue at risk (sum of loser deltas): ${formatCurrency(scenarioRevenueAtRisk)}
- Revenue captured (sum of winner deltas): ${formatCurrency(scenarioRevenueCaptured)}
- Firm-level break-even retainer: ${formatCurrency(firmBreakEven)}

Top 5 clients by revenue: ${rows
    .slice(0, 5)
    .map((r) => `${r.display} (${formatCurrency(r.totalBillable)}, ${r.matterCount} matter(s))`)
    .join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        <p className="text-muted-foreground text-sm mt-1">
          One row per client, aggregated across all their matters. Months active = first to last
          activity date across the client&rsquo;s matters. Use the retainer slider below to model
          a flat-monthly scenario: every KPI, histogram, and the Delta column recalculate live.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Decision inputs to weigh separately: tenure distribution of winners vs. losers (very
          short-tenure winners may not sign a retainer), acceptance-rate assumptions (some current
          losers would refuse a higher rate), single-matter vs. multi-matter client mix
          (retainers suit ongoing engagements), and potential tiered-retainer segmentation.
        </p>
      </div>

      <ClientsInteractive
        rows={rows}
        initialRetainer={retainer}
        initialFirstFrom={firstFrom}
        initialFirstTo={firstTo}
        initialTypes={initialTypes}
      />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
