import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters, fetchMatterRollup, type MatterRollup } from "@/lib/queries"
import { ClientsInteractive } from "@/components/ClientsInteractive"
import { AIChatAssistant } from "@/components/AIChatAssistant"
import { parseClientsField } from "@/lib/utils/clients"
import { formatCurrency } from "@/lib/utils/format"

export const maxDuration = 60
export const revalidate = 300

const DAYS_PER_MONTH = 30.44
const DEFAULT_RETAINER = 1500

export type EngagementType =
  | "ongoing" // span ≥ 30 days
  | "short-burst" // 2–29 days, ≥2 activities
  | "single-activity" // exactly 1 activity across all their matters
  | "unlogged" // zero activities across all their matters (new matter, nothing billed yet)
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
  /** Earliest open_date across all this client's matters — answers "when did this client onboard?". */
  firstMatterOpenDate: string | null
  /** Latest open_date across all this client's matters. */
  lastMatterOpenDate: string | null
  /** firstActivityDate, falling back to firstMatterOpenDate for activity-less matters.
   *  This is what the cohort "first appearance" filter uses so brand-new matters
   *  with no activities logged yet still show up. */
  firstAppearance: string | null
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
  const downpaymentParam =
    typeof params.downpayment === "string" ? Number(params.downpayment) : NaN
  const downpayment =
    Number.isFinite(downpaymentParam) && downpaymentParam >= 0
      ? Math.min(50000, downpaymentParam)
      : 0
  const minMonthsParam =
    typeof params.minMonths === "string" ? Number(params.minMonths) : NaN
  const minMonths =
    Number.isFinite(minMonthsParam) && minMonthsParam >= 0
      ? Math.min(60, minMonthsParam)
      : 0
  const firstFrom = typeof params.firstFrom === "string" ? params.firstFrom : ""
  const firstTo = typeof params.firstTo === "string" ? params.firstTo : ""
  const openFrom = typeof params.openFrom === "string" ? params.openFrom : ""
  const openTo = typeof params.openTo === "string" ? params.openTo : ""
  const typesParam = typeof params.types === "string" ? params.types : ""
  const initialTypes = typesParam ? typesParam.split(",").filter(Boolean) : []

  let matters: Awaited<ReturnType<typeof fetchMatters>>
  let rollupByMatter: Map<string, MatterRollup>
  try {
    const t0 = Date.now()
    ;[matters, rollupByMatter] = await Promise.all([
      fetchMatters(supabase, filters),
      fetchMatterRollup(supabase, filters),
    ])
    console.log(
      `[clients] ${matters.length} matters / ${rollupByMatter.size} rollups in ${Date.now() - t0}ms`,
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

  // Aggregate per client from server-side rollup (one row per matter).
  const byClient = new Map<
    string,
    {
      display: string
      isJoint: boolean
      totalBillable: number
      matterCount: number
      firstActivityDate: string | null
      lastActivityDate: string | null
      allMatterOpenDates: string[]
      flatRateBillable: number
      legacyBillable: number
      totalActivityCount: number
      matters: ClientMatter[]
    }
  >()

  for (const m of matters) {
    const parsed = parseClientsField(m.clients)
    const billable = m.total_billable ?? 0
    const r = rollupByMatter.get(m.unique_id)
    const firstDate = r?.first_activity_date ?? null
    const lastDate = r?.last_activity_date ?? null
    const flatRateBillable = r?.flat_rate_billable ?? 0
    const legacyBillable = r?.legacy_billable ?? 0
    const activityCount = Number(r?.activity_count ?? 0)

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
      hasFlatRateActivity: flatRateBillable > 0,
      hasLegacyMigration: legacyBillable > 0,
    }

    const existing = byClient.get(parsed.key)
    if (existing) {
      existing.totalBillable += billable
      existing.matterCount += 1
      if (firstDate && (!existing.firstActivityDate || firstDate < existing.firstActivityDate)) {
        existing.firstActivityDate = firstDate
      }
      if (lastDate && (!existing.lastActivityDate || lastDate > existing.lastActivityDate)) {
        existing.lastActivityDate = lastDate
      }
      if (m.open_date) existing.allMatterOpenDates.push(m.open_date)
      existing.flatRateBillable += flatRateBillable
      existing.legacyBillable += legacyBillable
      existing.totalActivityCount += activityCount
      existing.matters.push(clientMatter)
    } else {
      byClient.set(parsed.key, {
        display: parsed.display,
        isJoint: parsed.isJoint,
        totalBillable: billable,
        matterCount: 1,
        firstActivityDate: firstDate,
        lastActivityDate: lastDate,
        allMatterOpenDates: m.open_date ? [m.open_date] : [],
        flatRateBillable,
        legacyBillable,
        totalActivityCount: activityCount,
        matters: [clientMatter],
      })
    }
  }

  const rows: ClientRow[] = []
  for (const [clientKey, v] of byClient.entries()) {
    const firstDate = v.firstActivityDate
    const lastDate = v.lastActivityDate
    let monthsActive = 0
    let spanDays = 0
    if (firstDate && lastDate) {
      spanDays =
        (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)
      monthsActive = Math.max(0, spanDays / DAYS_PER_MONTH)
    }

    const sortedOpens = [...v.allMatterOpenDates].sort()
    const firstMatterOpenDate = sortedOpens[0] ?? null
    const lastMatterOpenDate = sortedOpens[sortedOpens.length - 1] ?? null
    // firstAppearance = firstActivity if we have activities, else falls back to earliest open_date
    // so brand-new matters with zero activities logged still have a cohort date.
    const firstAppearance = firstDate ?? firstMatterOpenDate

    // Engagement classification:
    // - unlogged: zero activities across all their matters — new matter, nothing billed yet
    // - legacy-migration: majority of revenue is from Xero 2016-11-06 balance-forwards
    // - flat-fee: ≥70% of revenue is from flat_rate activities
    // - single-activity: exactly 1 activity across all matters
    // - short-burst: span 2–29 days with multiple activities (OP/DV/quick-turn)
    // - ongoing: everything else (span ≥ 30 days OR fallback)
    const totalActivityCount = v.totalActivityCount
    let engagementType: EngagementType
    const hasRevenue = v.totalBillable > 0
    const legacyShare = hasRevenue ? v.legacyBillable / v.totalBillable : 0
    const flatShare = hasRevenue ? v.flatRateBillable / v.totalBillable : 0
    if (totalActivityCount === 0) {
      engagementType = "unlogged"
    } else if (legacyShare >= 0.5) {
      engagementType = "legacy-migration"
    } else if (flatShare >= 0.7) {
      engagementType = "flat-fee"
    } else if (totalActivityCount === 1) {
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
      firstMatterOpenDate,
      lastMatterOpenDate,
      firstAppearance,
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
        initialDownpayment={downpayment}
        initialMinMonths={minMonths}
        initialFirstFrom={firstFrom}
        initialFirstTo={firstTo}
        initialOpenFrom={openFrom}
        initialOpenTo={openTo}
        initialTypes={initialTypes}
      />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
