import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { fetchSpikeActivities } from "@/lib/queries"

export const maxDuration = 60

const ATTORNEY_RATE = 400
const PARALEGAL_RATE = 225
/** Activities billed at >= this hourly rate are bucketed as attorney time;
 *  below it as paralegal/admin. Tuned to historical rate values seen in the
 *  data (rates of 300/325/350 = attorney; 175/200/225 = paralegal). */
const ATTORNEY_RATE_THRESHOLD = 250

interface ClassifiedSpike {
  matter_unique_id: string
  week_start: string
  display_number: string
  client_display: string
  billable: number
  ratio: number
  hours: number
  lifecycleStage: string
  mapped_category: string | null
  primary_event: string
  secondary_events: string[]
  narrative: string
}

interface UnitEconomics {
  recommended_surcharge: number
  actual_avg_billable: number
  repriced_avg_cost: number
  avg_attorney_hours: number
  avg_paralegal_hours: number
  avg_total_hours: number
  avg_days: number
  spike_day_unit_cost: number
  surcharge_to_unit_cost_ratio: number
}

interface SurchargeTier {
  event_type: string
  recommended_surcharge: number
  rationale: string
  estimated_annual_revenue: number
  spike_frequency: number
  caveats: string[]
  unit_economics: UnitEconomics
  market_pressure_test: string
  margin_analysis: string
}

interface ThematicCluster {
  cluster_name: string
  events_in_cluster: string[]
  total_billable: number
  spike_count: number
  insight: string
}

interface MetaAnalysisResult {
  executive_summary: string
  rate_assumptions: {
    attorney_rate: number
    paralegal_rate: number
    note: string
  }
  surcharge_tiers: SurchargeTier[]
  thematic_clusters: ThematicCluster[]
  lifecycle_insights: { stage: string; observation: string }[]
  attorney_observations: string
  risk_flags: string[]
  recommended_next_steps: string[]
}

const SYSTEM_PROMPT = `You are a billing-strategy consultant for a premium family-law firm in a major US metro market. The firm is moving from hourly billing to a flat monthly retainer + event-based surcharges. They've classified historical "spike weeks" into legal events; your job is to set defensible surcharge tiers.

The firm's reference rates are $400/hr attorney and $225/hr paralegal. You will receive per-spike unit-economics data already computed at those rates. Your recommendations MUST be anchored to that data — no round-number guessing.

For each event type:
1. **Compute the unit cost** at premium rates: avg_attorney_hours × $400 + avg_paralegal_hours × $225. The user's input already includes this as 'repriced_avg_cost'.
2. **Compute the per-day unit** ('<Event>-Spike-Day' = repriced_avg_cost / avg_days). E.g. a 3-day deposition averaging $6,000 repriced = $2,000/Spike-Day.
3. **Set the surcharge** as a multiplier on the unit cost, NOT a flat number. Premium divorce firms typically charge a **1.0x–1.4x markup** over fully-loaded cost for high-skill events (trial weeks, depositions, mediations) and a **1.0x–1.1x markup** for routine ones (court hearings, motion drafting). The surcharge should usually equal or modestly exceed repriced_avg_cost for high-value events. A surcharge significantly *below* repriced_avg_cost is leaving money on the table — flag this as undercharging.
4. **Pressure-test** by asking: would a sophisticated divorce client at a premium firm in NYC/Chicago/SF/LA accept this surcharge for this kind of service? Reference market norms in market_pressure_test.
5. **Margin analysis**: state the recommended surcharge as both an absolute $ and as a ratio over repriced_avg_cost (1.2x, 1.5x, etc.). If the ratio is <1.0, explain why (e.g., high frequency events don't need premium markup).

Return ONLY valid JSON, no preamble:
{
  "executive_summary": "<2-3 sentences. MUST mention if current billing is undercharging vs. premium-rate cost.>",
  "rate_assumptions": {
    "attorney_rate": 400,
    "paralegal_rate": 225,
    "note": "<one sentence acknowledging that historical billable amounts may be at lower rates, and that recommendations are anchored to fully-loaded premium-rate cost>"
  },
  "surcharge_tiers": [
    {
      "event_type": "<MUST match a primary_event from the input>",
      "recommended_surcharge": <integer dollar amount>,
      "rationale": "<one sentence on the markup multiplier and why it fits this event>",
      "estimated_annual_revenue": <integer; surcharge × spike_frequency, no more>,
      "spike_frequency": <integer>,
      "caveats": ["<short caveat>", "<another>"],
      "unit_economics": {
        "recommended_surcharge": <same as recommended_surcharge above>,
        "actual_avg_billable": <integer; what the firm actually charged on average>,
        "repriced_avg_cost": <integer; cost at $400/$225 rates>,
        "avg_attorney_hours": <number>,
        "avg_paralegal_hours": <number>,
        "avg_total_hours": <number>,
        "avg_days": <number>,
        "spike_day_unit_cost": <integer; repriced_avg_cost / avg_days>,
        "surcharge_to_unit_cost_ratio": <number; recommended_surcharge / repriced_avg_cost>
      },
      "market_pressure_test": "<one short paragraph: is this surcharge defensible at a premium divorce firm? Reference what high-end firms typically charge for similar work. Be concrete: NYC firms charging $X for trial day; LA firms charging $Y for emergency motions, etc.>",
      "margin_analysis": "<one sentence: 'Recommended $X is a 1.2x markup on $Y repriced cost; firm captures $Z above cost per occurrence.'>"
    }
  ],
  "thematic_clusters": [
    {"cluster_name": "<...>", "events_in_cluster": ["<...>"], "total_billable": <int>, "spike_count": <int>, "insight": "<...>"}
  ],
  "lifecycle_insights": [{"stage": "<...>", "observation": "<...>"}],
  "attorney_observations": "<paragraph if patterns by attorney appear>",
  "risk_flags": ["<flag>", "<flag>"],
  "recommended_next_steps": ["<action>", "<action>", "<action>"]
}`

interface SpikeWithUnitEconomics extends ClassifiedSpike {
  attorney_hours: number
  paralegal_hours: number
  total_hours: number
  days: number
  repriced_cost: number
}

function computeUnitEconomics(
  spike: ClassifiedSpike,
  activities: Awaited<ReturnType<typeof fetchSpikeActivities>>,
): SpikeWithUnitEconomics {
  let attorneyHours = 0
  let paralegalHours = 0
  const dates = new Set<string>()
  for (const a of activities) {
    if (a.activity_date) dates.add(a.activity_date)
    if (a.rate >= ATTORNEY_RATE_THRESHOLD) {
      attorneyHours += a.hours
    } else {
      paralegalHours += a.hours
    }
  }
  const totalHours = attorneyHours + paralegalHours
  const repricedCost = attorneyHours * ATTORNEY_RATE + paralegalHours * PARALEGAL_RATE
  return {
    ...spike,
    attorney_hours: Number(attorneyHours.toFixed(2)),
    paralegal_hours: Number(paralegalHours.toFixed(2)),
    total_hours: Number(totalHours.toFixed(2)),
    days: dates.size || 1,
    repriced_cost: Math.round(repricedCost),
  }
}

interface EventAggregate {
  event: string
  spike_frequency: number
  actual_avg_billable: number
  repriced_avg_cost: number
  avg_attorney_hours: number
  avg_paralegal_hours: number
  avg_total_hours: number
  avg_days: number
  spike_day_unit_cost: number
  example_matters: string[]
}

function aggregateByEvent(spikes: SpikeWithUnitEconomics[]): EventAggregate[] {
  const groups = new Map<string, SpikeWithUnitEconomics[]>()
  for (const s of spikes) {
    const arr = groups.get(s.primary_event)
    if (arr) arr.push(s)
    else groups.set(s.primary_event, [s])
  }
  const out: EventAggregate[] = []
  for (const [event, rows] of groups.entries()) {
    const n = rows.length
    const sum = (f: (r: SpikeWithUnitEconomics) => number) =>
      rows.reduce((s, r) => s + f(r), 0)
    const avg = (f: (r: SpikeWithUnitEconomics) => number) =>
      Math.round((sum(f) / n) * 100) / 100
    const avgBillable = sum((r) => r.billable) / n
    const avgRepriced = sum((r) => r.repriced_cost) / n
    const avgDays = sum((r) => r.days) / n
    out.push({
      event,
      spike_frequency: n,
      actual_avg_billable: Math.round(avgBillable),
      repriced_avg_cost: Math.round(avgRepriced),
      avg_attorney_hours: avg((r) => r.attorney_hours),
      avg_paralegal_hours: avg((r) => r.paralegal_hours),
      avg_total_hours: avg((r) => r.total_hours),
      avg_days: Number(avgDays.toFixed(2)),
      spike_day_unit_cost: Math.round(avgRepriced / Math.max(1, avgDays)),
      example_matters: rows.slice(0, 4).map((r) => r.display_number),
    })
  }
  return out.sort((a, b) => b.repriced_avg_cost * b.spike_frequency - a.repriced_avg_cost * a.spike_frequency)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  let body: { classifiedSpikes: ClassifiedSpike[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const inputs = body.classifiedSpikes ?? []
  if (inputs.length === 0) {
    return NextResponse.json(
      { error: "classifiedSpikes is required and must be non-empty" },
      { status: 400 },
    )
  }

  // Fetch activity records for each classified spike (parallel batches) and
  // compute unit economics: attorney/paralegal hour split, days of activity,
  // repriced cost at $400/$225.
  const concurrency = 10
  const enriched: SpikeWithUnitEconomics[] = []
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (s) => {
        const acts = await fetchSpikeActivities(supabase, s.matter_unique_id, s.week_start).catch(() => [])
        return computeUnitEconomics(s, acts)
      }),
    )
    enriched.push(...results)
  }

  const eventAggregates = aggregateByEvent(enriched)

  // Compact payload: per-spike rows + per-event aggregates. Aggregates are the
  // primary anchor for Claude's recommendations; per-spike rows give it the
  // narrative context to reason about.
  const compactSpikes = enriched.map((s) => ({
    event: s.primary_event,
    matter: s.display_number,
    week: s.week_start,
    actual_$: Math.round(s.billable),
    repriced_$: s.repriced_cost,
    atty_hrs: s.attorney_hours,
    para_hrs: s.paralegal_hours,
    days: s.days,
    ratio: Number(s.ratio.toFixed(1)),
    stage: s.lifecycleStage,
    note: s.narrative.slice(0, 150),
  }))

  const userMessage = `Reference rates: attorney $${ATTORNEY_RATE}/hr, paralegal $${PARALEGAL_RATE}/hr.

Per-event aggregates (anchor your recommendations to these):
${JSON.stringify(eventAggregates, null, 2)}

Per-spike detail (for narrative reasoning):
${JSON.stringify(compactSpikes)}

Produce the strategic JSON described in the system prompt. Recommendations MUST cite repriced_avg_cost from the aggregates above.`

  const client = new Anthropic({ apiKey })
  let result: MetaAnalysisResult
  let raw = ""
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    })
    raw = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("")
    const stripped = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim()
    result = JSON.parse(stripped)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[meta-spike-analysis] failed:", msg, "raw:", raw.slice(0, 500))
    return NextResponse.json(
      { error: msg, rawSnippet: raw.slice(0, 500) },
      { status: 500 },
    )
  }

  // Persist so the dashboard hydrates on reload without re-billing the API.
  const { error: persistErr } = await supabase.from("clio_meta_analyses").insert({
    input_count: inputs.length,
    attorney_rate: ATTORNEY_RATE,
    paralegal_rate: PARALEGAL_RATE,
    result,
    event_aggregates: eventAggregates,
    model_used: "claude-sonnet-4-20250514",
  })
  if (persistErr) console.error("[meta-spike-analysis] persist failed:", persistErr.message)

  return NextResponse.json({
    inputCount: inputs.length,
    rateAssumptions: { attorney_rate: ATTORNEY_RATE, paralegal_rate: PARALEGAL_RATE },
    eventAggregates,
    ...result,
  })
}
