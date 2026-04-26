import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { fetchSpikeActivities } from "@/lib/queries"

export const maxDuration = 90

interface InputSpike {
  matter_unique_id: string
  week_start: string
  display_number: string
  client_display: string
  billable: number
  ratio: number
  hours: number
}

interface SpikeAnalysisRow {
  matter_unique_id: string
  week_start: string
  display_number: string
  primary_event: string
  secondary_events: string[]
  narrative: string
  evidence_quotes: string[]
}

interface AggregateInsight {
  event_type: string
  spike_count: number
  total_billable: number
  example_matters: string[]
  pattern_notes: string
}

const SYSTEM_PROMPT = `You are a billing-analysis specialist for a family-law firm. You will be given a list of "spike weeks" — weeks where one specific matter generated unusually high billable activity. For each spike, you will see the actual activity descriptions, hours, and billable amounts that were logged.

Your job is to classify what *event* drove each spike. You are NOT extracting keywords — you are inferring the underlying legal event from the pattern of activities. For example:
- Several "depo prep", "review depo transcript", "deposition" entries → event = "Deposition"
- Multiple "trial prep", "cross-examination outline", "trial day" entries → event = "Trial week"
- "MSC", "settlement conference", "mediation" → event = "Mediation/Settlement Conference"
- "TRO", "ex parte", "emergency motion" → event = "Emergency Motion / TRO"
- "discovery responses", "interrogatories", "RFPs" → event = "Discovery Response Cycle"
- "OSC", "RFO", "motion hearing", "court appearance" → event = "Court Hearing"
- Many short admin entries with no clear single event → event = "Admin Burst"
- Heavy expert/financial work → event = "Forensic / Expert Engagement"
- Drafting briefs, motions, oppositions → event = "Briefing Cycle"
- Travel + court + multiple attorneys → event = "Out-of-town Court Appearance"

Use a SHORT title-case event name. Reuse the same event name across spikes when the pattern matches — that's how the user will spot patterns.

Return ONLY valid JSON, no preamble, in this exact schema:
{
  "spikes": [
    {
      "matter_unique_id": "<the input id>",
      "week_start": "<the input week_start>",
      "display_number": "<the input display_number>",
      "primary_event": "<short event name>",
      "secondary_events": ["<other events that overlapped, if any>"],
      "narrative": "<one sentence (max 25 words) describing what was happening>",
      "evidence_quotes": ["<verbatim short quote from a description>", "<another>"]
    }
  ],
  "aggregate": [
    {
      "event_type": "<event name, MUST match a primary_event used above>",
      "spike_count": <integer>,
      "total_billable": <sum across these spikes>,
      "example_matters": ["<display_number>", "<display_number>"],
      "pattern_notes": "<one sentence on the surcharge implication for this event type>"
    }
  ]
}`

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

  let body: { spikes: InputSpike[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const inputs = (body.spikes ?? []).slice(0, 50)
  if (inputs.length === 0) {
    return NextResponse.json({ error: "spikes array is required" }, { status: 400 })
  }

  // Fetch activities for each spike in parallel batches.
  const concurrency = 10
  const enriched: Array<{ spike: InputSpike; activities: Awaited<ReturnType<typeof fetchSpikeActivities>> }> = []
  for (let i = 0; i < inputs.length; i += concurrency) {
    const batch = inputs.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (s) => ({
        spike: s,
        activities: await fetchSpikeActivities(supabase, s.matter_unique_id, s.week_start).catch(() => []),
      })),
    )
    enriched.push(...results)
  }

  // Build the analysis payload — keep it compact to stay under token limits.
  const payload = enriched.map(({ spike, activities }) => ({
    matter_unique_id: spike.matter_unique_id,
    week_start: spike.week_start,
    display_number: spike.display_number,
    client: spike.client_display,
    week_billable: Math.round(spike.billable),
    ratio: Number(spike.ratio.toFixed(2)),
    hours: Number(spike.hours.toFixed(1)),
    activities: activities.map((a) => ({
      date: a.activity_date,
      type: a.type,
      user: a.user_name,
      desc: (a.description ?? "").slice(0, 200),
      hrs: Number(a.hours.toFixed(2)),
      $: Math.round(a.billable_amount),
    })),
  }))

  const client = new Anthropic({ apiKey })
  let analysis: { spikes: SpikeAnalysisRow[]; aggregate: AggregateInsight[] }
  let rawText = ""
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here are ${payload.length} spike weeks to analyze. Return the JSON described in the system prompt.\n\n${JSON.stringify(payload)}`,
        },
      ],
    })
    rawText = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[analyze-spikes] Claude call failed:", msg)
    return NextResponse.json(
      { error: `Claude API call failed: ${msg}` },
      { status: 500 },
    )
  }

  try {
    // Strip code-fence wrapping if Claude added one despite being told not to.
    const stripped = rawText.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim()
    analysis = JSON.parse(stripped)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[analyze-spikes] JSON parse failed:", msg, "raw:", rawText.slice(0, 500))
    return NextResponse.json(
      {
        error: `AI returned non-JSON: ${msg}`,
        rawSnippet: rawText.slice(0, 500),
      },
      { status: 500 },
    )
  }

  // Persist each per-spike row so future page loads can show the analysis
  // without re-billing the Anthropic API.
  if (analysis.spikes && analysis.spikes.length > 0) {
    const upsertRows = analysis.spikes.map((s) => ({
      matter_unique_id: s.matter_unique_id,
      week_start: s.week_start,
      primary_event: s.primary_event,
      secondary_events: s.secondary_events ?? [],
      narrative: s.narrative ?? "",
      evidence_quotes: s.evidence_quotes ?? [],
      model_used: "claude-sonnet-4-20250514",
      analyzed_at: new Date().toISOString(),
    }))
    const { error: upsertErr } = await supabase
      .from("clio_spike_analyses")
      .upsert(upsertRows, { onConflict: "matter_unique_id,week_start" })
    if (upsertErr) console.error("[analyze-spikes] persist failed:", upsertErr.message)
  }

  return NextResponse.json({
    analyzedCount: enriched.length,
    totalActivities: enriched.reduce((s, e) => s + e.activities.length, 0),
    ...analysis,
  })
}
