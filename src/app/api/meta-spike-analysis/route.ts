import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"

export const maxDuration = 60

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

interface SurchargeTier {
  event_type: string
  recommended_surcharge: number
  rationale: string
  estimated_annual_revenue: number
  spike_frequency: number
  caveats: string[]
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
  surcharge_tiers: SurchargeTier[]
  thematic_clusters: ThematicCluster[]
  lifecycle_insights: { stage: string; observation: string }[]
  attorney_observations: string
  risk_flags: string[]
  recommended_next_steps: string[]
}

const SYSTEM_PROMPT = `You are a billing-strategy consultant for a family law firm. The firm currently bills hourly and is considering switching to a flat monthly retainer plus event-based surcharges. They've already classified individual "activity spikes" — weeks where one matter's billable activity exceeded its baseline — into legal-event categories (Deposition, Trial Week, Mediation, Discovery Cycle, Court Hearing, etc.).

Your job is to take that classified spike data and produce a strategic recommendation: which events should carry surcharges, how much, what to watch out for, and what patterns emerge across the firm.

Return ONLY valid JSON, no preamble, in this exact schema:
{
  "executive_summary": "<2-3 sentences on what the data shows about how spikes happen at this firm>",
  "surcharge_tiers": [
    {
      "event_type": "<MUST match one of the primary_event values from the input>",
      "recommended_surcharge": <integer dollar amount, the surcharge per occurrence>,
      "rationale": "<one sentence on why this number>",
      "estimated_annual_revenue": <integer; if this surcharge applied across the observed historical frequency, estimated annual revenue impact>,
      "spike_frequency": <integer count from the input>,
      "caveats": ["<short caveat>", "<another>"]
    }
  ],
  "thematic_clusters": [
    {
      "cluster_name": "<name a meaningful grouping, e.g. 'Court-driven events' or 'Discovery / preparation cycles'>",
      "events_in_cluster": ["<primary_event>", "<primary_event>"],
      "total_billable": <sum across these events>,
      "spike_count": <total spikes in cluster>,
      "insight": "<one sentence on what this cluster reveals>"
    }
  ],
  "lifecycle_insights": [
    {"stage": "<First month | Early | Middle | Late | Last month | Single-month case>", "observation": "<one sentence>"}
  ],
  "attorney_observations": "<one short paragraph if any attorney-specific patterns appear in the descriptions>",
  "risk_flags": ["<one concise warning>", "<another>"],
  "recommended_next_steps": ["<concrete action>", "<another>", "<another>"]
}

Be specific with dollar amounts. Don't recommend a $500 surcharge for everything — different events warrant different tiers (e.g., a $250 motion hearing vs a $2,000 trial day). Use the spike billable amounts in the input as anchor points. Pattern_notes at the bottom must contain real, defensible recommendations grounded in the data the user gave you.`

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

  // Compact the payload — Claude only needs event labels, dollar amounts,
  // ratios, lifecycle stage, category, and short narratives.
  const compact = inputs.map((s) => ({
    event: s.primary_event,
    secondary: s.secondary_events,
    matter: s.display_number,
    week: s.week_start,
    $: Math.round(s.billable),
    ratio: Number(s.ratio.toFixed(1)),
    hrs: Number(s.hours.toFixed(1)),
    stage: s.lifecycleStage,
    cat: s.mapped_category,
    note: s.narrative.slice(0, 200),
  }))

  const client = new Anthropic({ apiKey })
  let result: MetaAnalysisResult
  let raw = ""
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here are ${compact.length} previously-classified spike weeks from this firm. Produce the strategic JSON described in the system prompt.\n\n${JSON.stringify(compact)}`,
        },
      ],
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

  return NextResponse.json({
    inputCount: inputs.length,
    ...result,
  })
}
