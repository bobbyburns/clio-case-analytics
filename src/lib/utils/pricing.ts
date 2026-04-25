import type { Matter, Activity } from "@/lib/types"
import { mean, median, percentile, stdDev } from "./stats"

const DAYS_PER_MONTH = 30.44

export interface ScenarioMatter {
  unique_id: string
  display_number: string
  clients: string | null
  status: string
  mapped_category: string | null
  case_type: string | null
  responsible_attorney: string | null
  open_date: string | null
  close_date: string | null
  totalBillable: number
  activeMonths: number
  activeMonthsRaw: number
  firstActivityDate: string | null
  lastActivityDate: string | null
  isExistingFlatFee: boolean
  hasFlatRateActivity: boolean
}

export interface ScenarioResult {
  matter: ScenarioMatter
  hypotheticalRevenue: number
  delta: number
  isWinner: boolean
}

export interface BreakEvenValues {
  firmLevel: number
  perMatterMedian: number
  perMatterMean: number
}

/** A matter is treated as "existing flat fee" (and excluded from the hourly baseline) if:
 *  - any of its activities has flat_rate=true, OR
 *  - its retainer_type string contains "flat" (case-insensitive).
 *  Defensive because exact Clio values aren't known without SQL recon. */
export function isExistingFlatFee(
  matter: Pick<Matter, "retainer_type">,
  hasFlatRateActivity: boolean,
): boolean {
  if (hasFlatRateActivity) return true
  const rt = matter.retainer_type?.toLowerCase() ?? ""
  return rt.includes("flat")
}

/** Active months based on first→last activity_date span, floored to 1.
 *  Falls back to matter duration_days / open_date→close_date if no activities exist. */
export function computeActiveMonths(
  matter: Pick<Matter, "duration_days" | "open_date" | "close_date">,
  activitiesForMatter: Activity[],
): { activeMonths: number; rawMonths: number; firstDate: string | null; lastDate: string | null } {
  const dates = activitiesForMatter
    .map((a) => a.activity_date)
    .filter((d): d is string => !!d)
    .sort()

  let rawMonths: number
  let firstDate: string | null = null
  let lastDate: string | null = null

  if (dates.length > 0) {
    firstDate = dates[0]
    lastDate = dates[dates.length - 1]
    const spanDays =
      (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)
    rawMonths = spanDays / DAYS_PER_MONTH
  } else if (matter.duration_days != null) {
    rawMonths = matter.duration_days / DAYS_PER_MONTH
  } else if (matter.open_date) {
    const end = matter.close_date ? new Date(matter.close_date) : new Date()
    const spanDays = (end.getTime() - new Date(matter.open_date).getTime()) / (1000 * 60 * 60 * 24)
    rawMonths = Math.max(0, spanDays / DAYS_PER_MONTH)
  } else {
    rawMonths = 0
  }

  const activeMonths = Math.max(1, Math.ceil(rawMonths))
  return { activeMonths, rawMonths, firstDate, lastDate }
}

export interface MatterRollupInput {
  total_billable: number
  flat_rate_billable: number
  first_activity_date: string | null
  last_activity_date: string | null
}

/** Build scenario inputs from server-aggregated rollup. Skips per-activity loop. */
export function buildScenarioMattersFromRollup(
  matters: Matter[],
  rollupByMatter: Map<string, MatterRollupInput>,
): ScenarioMatter[] {
  return matters.map((m) => {
    const r = rollupByMatter.get(m.unique_id)
    const firstDate = r?.first_activity_date ?? null
    const lastDate = r?.last_activity_date ?? null
    let rawMonths: number
    if (firstDate && lastDate) {
      rawMonths =
        (new Date(lastDate).getTime() - new Date(firstDate).getTime()) /
        (1000 * 60 * 60 * 24 * DAYS_PER_MONTH)
    } else if (m.duration_days != null) {
      rawMonths = m.duration_days / DAYS_PER_MONTH
    } else if (m.open_date) {
      const end = m.close_date ? new Date(m.close_date) : new Date()
      const spanDays =
        (end.getTime() - new Date(m.open_date).getTime()) / (1000 * 60 * 60 * 24)
      rawMonths = Math.max(0, spanDays / DAYS_PER_MONTH)
    } else {
      rawMonths = 0
    }
    const activeMonths = Math.max(1, Math.ceil(rawMonths))
    const hasFlatRateActivity = (r?.flat_rate_billable ?? 0) > 0
    return {
      unique_id: m.unique_id,
      display_number: m.display_number,
      clients: m.clients,
      status: m.status,
      mapped_category: m.mapped_category,
      case_type: m.case_type,
      responsible_attorney: m.responsible_attorney,
      open_date: m.open_date,
      close_date: m.close_date,
      totalBillable: m.total_billable ?? 0,
      activeMonths,
      activeMonthsRaw: rawMonths,
      firstActivityDate: firstDate,
      lastActivityDate: lastDate,
      isExistingFlatFee: isExistingFlatFee(m, hasFlatRateActivity),
      hasFlatRateActivity,
    }
  })
}

/** Build per-matter scenario inputs. Groups activities by matter_unique_id once. */
export function buildScenarioMatters(
  matters: Matter[],
  activities: Activity[],
): ScenarioMatter[] {
  const activitiesByMatter = new Map<string, Activity[]>()
  for (const a of activities) {
    const key = String(a.matter_unique_id ?? "")
    if (!key) continue
    const arr = activitiesByMatter.get(key)
    if (arr) arr.push(a)
    else activitiesByMatter.set(key, [a])
  }

  return matters.map((m) => {
    const acts = activitiesByMatter.get(m.unique_id) ?? []
    const { activeMonths, rawMonths, firstDate, lastDate } = computeActiveMonths(m, acts)
    const hasFlatRateActivity = acts.some((a) => a.flat_rate === true)
    return {
      unique_id: m.unique_id,
      display_number: m.display_number,
      clients: m.clients,
      status: m.status,
      mapped_category: m.mapped_category,
      case_type: m.case_type,
      responsible_attorney: m.responsible_attorney,
      open_date: m.open_date,
      close_date: m.close_date,
      totalBillable: m.total_billable ?? 0,
      activeMonths,
      activeMonthsRaw: rawMonths,
      firstActivityDate: firstDate,
      lastActivityDate: lastDate,
      isExistingFlatFee: isExistingFlatFee(m, hasFlatRateActivity),
      hasFlatRateActivity,
    }
  })
}

export function runScenario(
  matters: ScenarioMatter[],
  retainer: number,
): ScenarioResult[] {
  return matters.map((m) => {
    const hypotheticalRevenue = m.activeMonths * retainer
    const delta = hypotheticalRevenue - m.totalBillable
    return {
      matter: m,
      hypotheticalRevenue,
      delta,
      isWinner: delta > 0,
    }
  })
}

/** Firm-level break-even retainer: Σ(totalBillable) / Σ(activeMonths). */
export function computeBreakEvenFirm(matters: ScenarioMatter[]): number {
  const totalBillable = matters.reduce((s, m) => s + m.totalBillable, 0)
  const totalMonths = matters.reduce((s, m) => s + m.activeMonths, 0)
  if (totalMonths === 0) return 0
  return totalBillable / totalMonths
}

/** Per-matter break-even values — the monthly revenue density distribution. */
export function computeBreakEvenPerMatter(matters: ScenarioMatter[]): BreakEvenValues & {
  densities: number[]
} {
  const densities = matters
    .filter((m) => m.totalBillable > 0 && m.activeMonths > 0)
    .map((m) => m.totalBillable / m.activeMonths)

  return {
    firmLevel: computeBreakEvenFirm(matters),
    perMatterMedian: median(densities),
    perMatterMean: mean(densities),
    densities,
  }
}

/** Density histogram buckets sized for monthly-revenue scale ($0-$10k+ per month). */
export function densityHistogram(densities: number[]): Array<{
  binStart: number
  binEnd: number
  label: string
  count: number
}> {
  const BUCKETS: Array<[number, number, string]> = [
    [0, 250, "<$250"],
    [250, 500, "$250–$500"],
    [500, 1000, "$500–$1k"],
    [1000, 1500, "$1k–$1.5k"],
    [1500, 2000, "$1.5k–$2k"],
    [2000, 2500, "$2k–$2.5k"],
    [2500, 3500, "$2.5k–$3.5k"],
    [3500, 5000, "$3.5k–$5k"],
    [5000, 7500, "$5k–$7.5k"],
    [7500, 10000, "$7.5k–$10k"],
    [10000, Number.POSITIVE_INFINITY, "$10k+"],
  ]

  const result = BUCKETS.map(([lo, hi, label]) => ({
    binStart: lo,
    binEnd: hi === Number.POSITIVE_INFINITY ? 9_999_999 : hi,
    label,
    count: 0,
  }))

  for (const v of densities) {
    for (let i = 0; i < BUCKETS.length; i++) {
      if (v >= BUCKETS[i][0] && v < BUCKETS[i][1]) {
        result[i].count++
        break
      }
    }
  }
  return result
}

/** For the winners/losers histogram: delta bucketed in $-ranges. */
export function deltaHistogram(deltas: number[]): Array<{
  label: string
  count: number
  sign: "loss" | "gain" | "neutral"
}> {
  const BUCKETS: Array<[number, number, string, "loss" | "gain" | "neutral"]> = [
    [Number.NEGATIVE_INFINITY, -25000, "<-$25k", "loss"],
    [-25000, -10000, "-$25k to -$10k", "loss"],
    [-10000, -5000, "-$10k to -$5k", "loss"],
    [-5000, -2500, "-$5k to -$2.5k", "loss"],
    [-2500, -1000, "-$2.5k to -$1k", "loss"],
    [-1000, 0, "-$1k to $0", "loss"],
    [0, 1000, "$0 to $1k", "gain"],
    [1000, 2500, "$1k to $2.5k", "gain"],
    [2500, 5000, "$2.5k to $5k", "gain"],
    [5000, 10000, "$5k to $10k", "gain"],
    [10000, 25000, "$10k to $25k", "gain"],
    [25000, Number.POSITIVE_INFINITY, ">$25k", "gain"],
  ]

  const result = BUCKETS.map(([, , label, sign]) => ({ label, count: 0, sign }))

  for (const d of deltas) {
    for (let i = 0; i < BUCKETS.length; i++) {
      const [lo, hi] = BUCKETS[i]
      if (d >= lo && d < hi) {
        result[i].count++
        break
      }
    }
  }
  return result
}

/** Per-category break-even: median of (totalBillable/activeMonths) grouped by mapped_category. */
export function breakEvenByCategory(matters: ScenarioMatter[]): Array<{
  category: string
  matterCount: number
  medianDensity: number
  p25Density: number
  p75Density: number
}> {
  const byCategory = new Map<string, number[]>()
  for (const m of matters) {
    if (m.totalBillable <= 0 || m.activeMonths <= 0) continue
    const cat = m.mapped_category ?? m.case_type ?? "Unmapped"
    const density = m.totalBillable / m.activeMonths
    const arr = byCategory.get(cat)
    if (arr) arr.push(density)
    else byCategory.set(cat, [density])
  }

  return Array.from(byCategory.entries())
    .map(([category, densities]) => ({
      category,
      matterCount: densities.length,
      medianDensity: median(densities),
      p25Density: percentile(densities, 25),
      p75Density: percentile(densities, 75),
    }))
    .sort((a, b) => b.matterCount - a.matterCount)
}

/** Month-bucket actual billable revenue across all in-scope matters,
 *  weighted by each activity's contribution. Used for predictability stdDev. */
export function monthlyFirmRevenue(activities: Activity[]): Map<string, number> {
  const byMonth = new Map<string, number>()
  for (const a of activities) {
    if (!a.activity_date || (a.billable_amount ?? 0) <= 0) continue
    const ym = a.activity_date.slice(0, 7) // YYYY-MM
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + (a.billable_amount ?? 0))
  }
  return byMonth
}

/** Predictability: stdDev of monthly revenue under hourly billing vs. scenario. */
export function revenuePredictability(
  monthlyHourly: Map<string, number>,
  matters: ScenarioMatter[],
  retainer: number,
): { hourlyStdDev: number; scenarioStdDev: number; hourlyMean: number; scenarioMean: number } {
  const months = Array.from(monthlyHourly.keys()).sort()
  if (months.length === 0) {
    return { hourlyStdDev: 0, scenarioStdDev: 0, hourlyMean: 0, scenarioMean: 0 }
  }

  // Build scenario monthly revenue: for each month in range, count matters whose
  // activity span overlaps that month × retainer.
  const scenarioMonthly = new Map<string, number>()
  for (const m of matters) {
    if (!m.firstActivityDate) continue
    const first = m.firstActivityDate.slice(0, 7)
    const last = (m.lastActivityDate ?? m.firstActivityDate).slice(0, 7)
    for (const ym of months) {
      if (ym >= first && ym <= last) {
        scenarioMonthly.set(ym, (scenarioMonthly.get(ym) ?? 0) + retainer)
      }
    }
  }

  const hourlyVals = months.map((m) => monthlyHourly.get(m) ?? 0)
  const scenarioVals = months.map((m) => scenarioMonthly.get(m) ?? 0)

  return {
    hourlyStdDev: stdDev(hourlyVals),
    scenarioStdDev: stdDev(scenarioVals),
    hourlyMean: mean(hourlyVals),
    scenarioMean: mean(scenarioVals),
  }
}
