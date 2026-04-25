import { percentile } from "@/lib/utils/stats"

export interface MatterWeek {
  matter_unique_id: string
  week_start: string
  billable: number
  hours: number
  activity_count: number
}

export interface MatterBaseline {
  matter_unique_id: string
  weekCount: number
  median: number
  totalBillable: number
}

export interface Spike {
  matter_unique_id: string
  week_start: string
  billable: number
  hours: number
  activity_count: number
  baselineMedian: number
  ratio: number
  /** "ratio" if compared against the matter's median, "absolute" for sparse-baseline matters */
  rule: "ratio" | "absolute"
}

const MIN_BASELINE_WEEKS = 8

/** ISO week start (Monday) for an arbitrary date, to drop the in-flight current week. */
export function currentIsoWeekStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = d.getUTCDay() || 7
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1))
  return d.toISOString().slice(0, 10)
}

export function computeMatterBaselines(weeks: MatterWeek[]): Map<string, MatterBaseline> {
  const byMatter = new Map<string, MatterWeek[]>()
  for (const w of weeks) {
    const arr = byMatter.get(w.matter_unique_id)
    if (arr) arr.push(w)
    else byMatter.set(w.matter_unique_id, [w])
  }
  const out = new Map<string, MatterBaseline>()
  for (const [matter, rows] of byMatter.entries()) {
    const billables = rows.map((r) => r.billable).filter((b) => b > 0)
    out.set(matter, {
      matter_unique_id: matter,
      weekCount: rows.length,
      median: billables.length > 0 ? percentile(billables, 50) : 0,
      totalBillable: billables.reduce((s, b) => s + b, 0),
    })
  }
  return out
}

export interface DetectSpikesOptions {
  ratioThreshold: number
  absoluteFloor: number
  excludeWeekStart: string
}

export function detectSpikes(
  weeks: MatterWeek[],
  baselines: Map<string, MatterBaseline>,
  opts: DetectSpikesOptions,
): Spike[] {
  const out: Spike[] = []
  for (const w of weeks) {
    if (w.week_start >= opts.excludeWeekStart) continue
    if (w.billable < opts.absoluteFloor) continue

    const b = baselines.get(w.matter_unique_id)
    if (!b) continue

    if (b.weekCount < MIN_BASELINE_WEEKS || b.median <= 0) {
      // Sparse baseline — fall back to absolute floor only.
      out.push({
        matter_unique_id: w.matter_unique_id,
        week_start: w.week_start,
        billable: w.billable,
        hours: w.hours,
        activity_count: w.activity_count,
        baselineMedian: b.median,
        ratio: b.median > 0 ? w.billable / b.median : Number.POSITIVE_INFINITY,
        rule: "absolute",
      })
      continue
    }

    const ratio = w.billable / b.median
    if (ratio >= opts.ratioThreshold) {
      out.push({
        matter_unique_id: w.matter_unique_id,
        week_start: w.week_start,
        billable: w.billable,
        hours: w.hours,
        activity_count: w.activity_count,
        baselineMedian: b.median,
        ratio,
        rule: "ratio",
      })
    }
  }
  out.sort((a, b) => b.billable - a.billable)
  return out
}

/** Stop words tuned for legal time-entry descriptions. Common verbs, articles,
 *  prepositions, and Clio/admin filler that drown out signal terms. */
const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "from",
  "by", "at", "as", "is", "be", "or", "if", "it", "this", "that", "these",
  "those", "we", "i", "her", "his", "him", "she", "he", "they", "them",
  "our", "us", "client", "clients", "case", "cases", "matter", "matters",
  "re", "regarding", "about", "into", "out", "up", "down", "no", "yes",
  "ms", "mr", "mrs", "vs", "v", "et", "al", "via", "per", "all",
  "review", "reviewed", "reviewing", "draft", "drafted", "drafting",
  "prepare", "prepared", "preparing", "send", "sent", "sending",
  "receive", "received", "email", "emails", "call", "called", "phone",
  "discuss", "discussed", "discussion", "regarding", "work", "working",
  "file", "filed", "filing", "letter", "memo",
  "time", "entry", "fee", "billable",
])

/** Crude plural collapse: trailing "s"/"es"/"ies" → singular. Good enough for V1. */
function stem(word: string): string {
  if (word.length <= 3) return word
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y"
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2)
  if (word.endsWith("s")) return word.slice(0, -1)
  return word
}

export interface TriggerKeyword {
  keyword: string
  count: number
  totalBillable: number
}

export function tokenizeTriggers(
  records: Array<{ description: string | null; billable_amount: number | null }>,
): TriggerKeyword[] {
  const tally = new Map<string, { count: number; total: number }>()
  for (const r of records) {
    if (!r.description) continue
    const cleaned = r.description.toLowerCase().replace(/[^a-z\s'-]/g, " ")
    const words = cleaned.split(/\s+/).filter(Boolean)
    const seen = new Set<string>()
    for (const raw of words) {
      if (raw.length < 4) continue
      if (STOP_WORDS.has(raw)) continue
      const stemmed = stem(raw)
      if (STOP_WORDS.has(stemmed)) continue
      if (seen.has(stemmed)) continue
      seen.add(stemmed)
      const cur = tally.get(stemmed)
      if (cur) {
        cur.count++
        cur.total += r.billable_amount ?? 0
      } else {
        tally.set(stemmed, { count: 1, total: r.billable_amount ?? 0 })
      }
    }
  }
  return Array.from(tally.entries())
    .map(([keyword, v]) => ({
      keyword,
      count: v.count,
      totalBillable: v.total,
    }))
    .sort((a, b) => b.count - a.count)
}

/** Firm-wide weekly aggregation, plus 4-week rolling average. */
export function aggregateFirmWeekly(weeks: MatterWeek[]): Array<{
  week: string
  billable: number
  rolling4: number
}> {
  const byWeek = new Map<string, number>()
  for (const w of weeks) {
    byWeek.set(w.week_start, (byWeek.get(w.week_start) ?? 0) + w.billable)
  }
  const sorted = Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, billable]) => ({ week, billable }))

  const out: Array<{ week: string; billable: number; rolling4: number }> = []
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.max(0, i - 3)
    const window = sorted.slice(start, i + 1)
    const avg = window.reduce((s, r) => s + r.billable, 0) / window.length
    out.push({ week: sorted[i].week, billable: sorted[i].billable, rolling4: avg })
  }
  return out
}
