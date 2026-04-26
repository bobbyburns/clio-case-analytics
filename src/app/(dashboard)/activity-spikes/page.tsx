import { createClient } from "@/lib/supabase/server"
import {
  parseFilters,
  fetchMatters,
  fetchMatterWeeklyBillable,
  fetchSpikeActivities,
  fetchSpikeAnalyses,
  fetchLatestMetaAnalysis,
  type SpikeActivityRow,
  type SpikeAnalysisRecord,
  type MetaAnalysisRecord,
} from "@/lib/queries"
import {
  computeMatterBaselines,
  detectSpikes,
  aggregateFirmWeekly,
  currentIsoWeekStart,
  tokenizeTriggers,
  type Spike,
  type TriggerKeyword,
} from "@/lib/spikes"
import { ActivitySpikesInteractive } from "@/components/ActivitySpikesInteractive"
import { AIChatAssistant } from "@/components/AIChatAssistant"
import { parseClientsField } from "@/lib/utils/clients"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import type { Matter } from "@/lib/types"

export const maxDuration = 60
export const revalidate = 300

const DEFAULT_RATIO = 2.5
const DEFAULT_FLOOR = 250

export default async function ActivitySpikesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)

  const ratioParam =
    typeof params.ratio === "string" ? Number(params.ratio) : NaN
  const ratioThreshold =
    Number.isFinite(ratioParam) && ratioParam >= 1 && ratioParam <= 10
      ? ratioParam
      : DEFAULT_RATIO

  const floorParam =
    typeof params.floor === "string" ? Number(params.floor) : NaN
  const absoluteFloor =
    Number.isFinite(floorParam) && floorParam >= 0 ? Math.min(50000, floorParam) : DEFAULT_FLOOR

  const t0 = Date.now()
  let matters: Matter[]
  let weeks: Awaited<ReturnType<typeof fetchMatterWeeklyBillable>>
  let analysesByKey: Map<string, SpikeAnalysisRecord>
  let latestMeta: MetaAnalysisRecord | null
  try {
    ;[matters, weeks, analysesByKey, latestMeta] = await Promise.all([
      fetchMatters(supabase, filters),
      fetchMatterWeeklyBillable(supabase, filters),
      fetchSpikeAnalyses(supabase),
      fetchLatestMetaAnalysis(supabase),
    ])
    console.log(
      `[activity-spikes] ${matters.length} matters / ${weeks.length} matter-weeks / ${analysesByKey.size} stored analyses / meta=${latestMeta ? "yes" : "no"} in ${Date.now() - t0}ms`,
    )
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity Spikes</h1>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
          <h2 className="font-semibold text-rose-800">Data load failed</h2>
          <p className="mt-2 text-sm text-rose-700 font-mono whitespace-pre-wrap">{msg}</p>
        </div>
      </div>
    )
  }

  const matterById = new Map(matters.map((m) => [m.unique_id, m]))
  const inScopeMatterIds = new Set(matters.map((m) => m.unique_id))
  const inScopeWeeks = weeks.filter((w) => inScopeMatterIds.has(w.matter_unique_id))

  // For each matter, pre-compute first/last activity week so we can bucket
  // spikes by lifecycle stage (first month, mid-case, last month, etc.).
  const lifecycleByMatter = new Map<string, { first: string; last: string; spanWeeks: number }>()
  {
    const grouped = new Map<string, string[]>()
    for (const w of inScopeWeeks) {
      const arr = grouped.get(w.matter_unique_id)
      if (arr) arr.push(w.week_start)
      else grouped.set(w.matter_unique_id, [w.week_start])
    }
    for (const [mid, wks] of grouped.entries()) {
      const sorted = [...wks].sort()
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const days =
        (new Date(last).getTime() - new Date(first).getTime()) / (1000 * 60 * 60 * 24)
      lifecycleByMatter.set(mid, {
        first,
        last,
        spanWeeks: Math.max(1, Math.round(days / 7) + 1),
      })
    }
  }

  const baselines = computeMatterBaselines(inScopeWeeks)
  const excludeWeekStart = currentIsoWeekStart()
  const spikes = detectSpikes(inScopeWeeks, baselines, {
    ratioThreshold,
    absoluteFloor,
    excludeWeekStart,
  })

  // Decorate spikes with matter/client display + lifecycle stage for the table,
  // plus any persisted AI analysis so the page shows pre-classified events
  // without re-running Claude.
  const spikeRows = spikes.map((s) => {
    const m = matterById.get(s.matter_unique_id)
    const client = m ? parseClientsField(m.clients) : { display: "—", isJoint: false }
    const lc = lifecycleByMatter.get(s.matter_unique_id)
    const stage = lc ? lifecycleStage(s.week_start, lc.first, lc.last, lc.spanWeeks) : "Unknown"
    const key = `${s.matter_unique_id}__${s.week_start}`
    const stored = analysesByKey.get(key)
    return {
      ...s,
      display_number: m?.display_number ?? s.matter_unique_id,
      client_display: client.display,
      mapped_category: m?.mapped_category ?? null,
      lifecycleStage: stage,
      storedAnalysis: stored
        ? {
            primary_event: stored.primary_event,
            secondary_events: stored.secondary_events,
            narrative: stored.narrative,
            evidence_quotes: stored.evidence_quotes,
            analyzed_at: stored.analyzed_at,
          }
        : null,
    }
  })

  // Spike timing distribution across lifecycle stages.
  const STAGE_ORDER = ["First month", "Early", "Middle", "Late", "Last month", "Single-month case"] as const
  const stageDistribution = STAGE_ORDER.map((stage) => {
    const matched = spikeRows.filter((s) => s.lifecycleStage === stage)
    return {
      stage,
      spikeCount: matched.length,
      spikeBillable: matched.reduce((sum, s) => sum + s.billable, 0),
      pctOfSpikes: spikes.length > 0 ? (matched.length / spikes.length) * 100 : 0,
    }
  })

  // Precompute Trigger Leaderboard server-side across the top 100 spikes by
  // billable. Without this, the leaderboard stays empty until the user clicks
  // open individual rows — which they correctly noted is unusable.
  const TOP_FOR_LEADERBOARD = 100
  const leaderboardSpikes = spikeRows.slice(0, TOP_FOR_LEADERBOARD)
  const leaderboardActivities = await fetchActivitiesBatched(supabase, leaderboardSpikes)
  const initialTriggerKeywords = tokenizeTriggers(leaderboardActivities).slice(0, 25)
  const initialExpenseCategories = aggregateExpenseCategories(leaderboardActivities)
  const initialTypeSplit = aggregateTypeSplit(leaderboardActivities)
  console.log(
    `[activity-spikes] leaderboard precomputed across ${leaderboardSpikes.length} spikes / ${leaderboardActivities.length} activities`,
  )

  // Firm-wide weekly aggregation (using the unfiltered matter-week rollup so the
  // chart shows firm-wide trends, not just the case-type filter scope).
  const firmWeekly = aggregateFirmWeekly(inScopeWeeks).filter(
    (w) => w.week < excludeWeekStart,
  )
  const spikeWeekSet = new Set(spikes.map((s) => s.week_start))

  // KPIs
  const totalFirmBillable = inScopeWeeks
    .filter((w) => w.week_start < excludeWeekStart)
    .reduce((s, w) => s + w.billable, 0)
  const totalSpikeBillable = spikes.reduce((s, sp) => s + sp.billable, 0)
  const sparseCount = spikes.filter((s) => s.rule === "absolute").length
  const ratioCount = spikes.filter((s) => s.rule === "ratio").length
  const ratiosArr = spikes.filter((s) => s.rule === "ratio").map((s) => s.ratio)
  const medianRatio =
    ratiosArr.length > 0
      ? [...ratiosArr].sort((a, b) => a - b)[Math.floor(ratiosArr.length / 2)]
      : 0
  const mattersWithSpike = new Set(spikes.map((s) => s.matter_unique_id)).size

  // Top-spike summary for AI page context.
  const topSpikesSummary = spikeRows.slice(0, 20).map((s) => ({
    matter: s.display_number,
    client: s.client_display,
    week: s.week_start,
    billable: s.billable,
    ratio: s.ratio,
  }))

  const pageContext = `Page: Activity Spikes
Detection rules: ratio ≥ ${ratioThreshold}× matter median weekly billable, absolute floor $${absoluteFloor}.
Sparse-baseline matters (<8 weeks of data) use the absolute floor only.

Firm scope: ${formatNumber(matters.length)} matters, ${formatNumber(inScopeWeeks.length)} matter-weeks of activity.
Total in-scope billable: ${formatCurrency(totalFirmBillable)}.

Spikes detected: ${formatNumber(spikes.length)} total (${formatNumber(ratioCount)} ratio-based, ${formatNumber(sparseCount)} absolute-only).
Spike billable: ${formatCurrency(totalSpikeBillable)} = ${totalFirmBillable > 0 ? ((totalSpikeBillable / totalFirmBillable) * 100).toFixed(1) : "0"}% of firm billable.
Matters with at least one spike: ${formatNumber(mattersWithSpike)} of ${formatNumber(matters.length)}.
Median spike ratio: ${medianRatio.toFixed(2)}×.

Top 20 spikes by billable amount:
${topSpikesSummary
    .map(
      (s) =>
        `- ${s.matter} (${s.client}) — week of ${s.week} — ${formatCurrency(s.billable)} (${s.ratio.toFixed(1)}× baseline)`,
    )
    .join("\n")}

Trigger keywords are computed client-side from the description field across all spike-week activities, displayed in the leaderboard at the bottom of the page.`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity Spikes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Identify matter-weeks where billable activity exceeds baseline. Use the trigger
          keywords to spot common drivers (hearings, depositions, motions) for surcharge planning.
        </p>
      </div>

      <ActivitySpikesInteractive
        spikes={spikeRows}
        firmWeekly={firmWeekly}
        spikeWeekSet={Array.from(spikeWeekSet)}
        initialRatio={ratioThreshold}
        initialFloor={absoluteFloor}
        stageDistribution={stageDistribution}
        initialTriggerKeywords={initialTriggerKeywords}
        initialExpenseCategories={initialExpenseCategories}
        initialTypeSplit={initialTypeSplit}
        leaderboardSampleSize={leaderboardSpikes.length}
        initialMetaAnalysis={latestMeta}
        kpis={{
          spikeCount: spikes.length,
          totalFirmBillable,
          totalSpikeBillable,
          mattersWithSpike,
          totalMatters: matters.length,
          medianRatio,
          sparseCount,
          ratioCount,
        }}
      />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}

export interface StoredSpikeAnalysis {
  primary_event: string
  secondary_events: string[]
  narrative: string
  evidence_quotes: string[]
  analyzed_at: string
}

export type SpikeRow = Spike & {
  display_number: string
  client_display: string
  mapped_category: string | null
  lifecycleStage: string
  storedAnalysis: StoredSpikeAnalysis | null
}

export type LifecycleStage =
  | "First month"
  | "Early"
  | "Middle"
  | "Late"
  | "Last month"
  | "Single-month case"
  | "Unknown"

export interface CategoryTally {
  category: string
  count: number
  total: number
}

export interface TypeSplit {
  timeCount: number
  expenseCount: number
  timeTotal: number
  expenseTotal: number
}

/** Fetch activities for many spike weeks in parallel with bounded concurrency,
 *  so the Trigger Leaderboard can be precomputed at page-render time. */
async function fetchActivitiesBatched(
  supabase: Awaited<ReturnType<typeof createClient>>,
  spikes: Array<{ matter_unique_id: string; week_start: string }>,
  concurrency = 10,
): Promise<SpikeActivityRow[]> {
  if (spikes.length === 0) return []
  const all: SpikeActivityRow[] = []
  for (let i = 0; i < spikes.length; i += concurrency) {
    const batch = spikes.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map((s) =>
        fetchSpikeActivities(supabase, s.matter_unique_id, s.week_start).catch(() => [] as SpikeActivityRow[]),
      ),
    )
    for (const arr of results) all.push(...arr)
  }
  return all
}

function aggregateExpenseCategories(rows: SpikeActivityRow[]): CategoryTally[] {
  const tally = new Map<string, { count: number; total: number }>()
  for (const a of rows) {
    const key = a.expense_category ?? "—"
    const cur = tally.get(key)
    if (cur) {
      cur.count++
      cur.total += a.billable_amount
    } else {
      tally.set(key, { count: 1, total: a.billable_amount })
    }
  }
  return Array.from(tally.entries())
    .map(([category, v]) => ({ category, count: v.count, total: v.total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
}

function aggregateTypeSplit(rows: SpikeActivityRow[]): TypeSplit {
  let timeCount = 0
  let expenseCount = 0
  let timeTotal = 0
  let expenseTotal = 0
  for (const a of rows) {
    if (a.type === "TimeEntry") {
      timeCount++
      timeTotal += a.billable_amount
    } else {
      expenseCount++
      expenseTotal += a.billable_amount
    }
  }
  return { timeCount, expenseCount, timeTotal, expenseTotal }
}

/** Bucket a spike's week_start into a coarse lifecycle stage relative to the
 *  matter's first→last activity span. Buckets are intentionally coarse — the
 *  user wants "first/last month vs. middle", not week-level precision. */
function lifecycleStage(
  weekStart: string,
  firstWeek: string,
  lastWeek: string,
  spanWeeks: number,
): LifecycleStage {
  if (spanWeeks <= 4) return "Single-month case"

  const w = new Date(weekStart).getTime()
  const f = new Date(firstWeek).getTime()
  const l = new Date(lastWeek).getTime()
  const monthMs = 30.44 * 24 * 60 * 60 * 1000

  if (w - f < monthMs) return "First month"
  if (l - w < monthMs) return "Last month"

  const span = l - f
  if (span <= 0) return "Middle"
  const pos = (w - f) / span // 0..1
  if (pos < 0.33) return "Early"
  if (pos > 0.66) return "Late"
  return "Middle"
}
