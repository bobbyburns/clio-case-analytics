"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, ChevronDown, ChevronRight } from "lucide-react"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import type { SpikeRow, StoredSpikeAnalysis } from "@/app/(dashboard)/activity-spikes/page"

const BATCH_SIZE = 10

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

const EVENT_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-orange-100 text-orange-800 border-orange-200",
  "bg-lime-100 text-lime-800 border-lime-200",
  "bg-pink-100 text-pink-800 border-pink-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
]

function colorFor(event: string, palette: Map<string, string>): string {
  const existing = palette.get(event)
  if (existing) return existing
  const next = EVENT_COLORS[palette.size % EVENT_COLORS.length]
  palette.set(event, next)
  return next
}

interface Progress {
  current: number
  total: number
}

interface Props {
  topSpikes: SpikeRow[]
  onAnalysisComplete: (key: string, analysis: StoredSpikeAnalysis) => void
}

export function SpikeEventAnalysis({ topSpikes, onAnalysisComplete }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Hydrate from any spikes that already have a stored AI analysis in the DB
  // so the user doesn't see an empty card after a page reload — the saved
  // results re-render immediately. Re-running fetches fresh classifications.
  const initialPerSpike: SpikeAnalysisRow[] = topSpikes
    .filter((s) => s.storedAnalysis)
    .map((s) => ({
      matter_unique_id: s.matter_unique_id,
      week_start: s.week_start,
      display_number: s.display_number,
      primary_event: s.storedAnalysis!.primary_event,
      secondary_events: s.storedAnalysis!.secondary_events,
      narrative: s.storedAnalysis!.narrative,
      evidence_quotes: s.storedAnalysis!.evidence_quotes,
    }))
  const [perSpike, setPerSpike] = useState<SpikeAnalysisRow[]>(initialPerSpike)
  const [analyzedCount, setAnalyzedCount] = useState(initialPerSpike.length)
  const [totalActivities, setTotalActivities] = useState(0)

  const inScope = topSpikes.slice(0, 50)
  const billableByKey = new Map<string, number>()
  for (const s of inScope) {
    billableByKey.set(`${s.matter_unique_id}__${s.week_start}`, s.billable)
  }

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    setPerSpike([])
    setAnalyzedCount(0)
    setTotalActivities(0)

    const total = inScope.length
    const batches: SpikeRow[][] = []
    for (let i = 0; i < total; i += BATCH_SIZE) {
      batches.push(inScope.slice(i, i + BATCH_SIZE))
    }
    setProgress({ current: 0, total })

    const accumulated: SpikeAnalysisRow[] = []
    let activitiesSeen = 0
    let analyzedSoFar = 0

    try {
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]
        const payload = batch.map((s) => ({
          matter_unique_id: s.matter_unique_id,
          week_start: s.week_start,
          display_number: s.display_number,
          client_display: s.client_display,
          billable: s.billable,
          ratio: Number.isFinite(s.ratio) ? s.ratio : 0,
          hours: s.hours,
        }))
        const res = await fetch("/api/analyze-spikes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spikes: payload }),
        })
        const text = await res.text()
        let data: {
          spikes?: SpikeAnalysisRow[]
          error?: string
          analyzedCount?: number
          totalActivities?: number
        }
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error(
            `Batch ${b + 1}/${batches.length} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
          )
        }
        if (!res.ok) {
          throw new Error(data.error ?? `Batch ${b + 1} failed (HTTP ${res.status})`)
        }
        const rows = data.spikes ?? []
        accumulated.push(...rows)
        activitiesSeen += data.totalActivities ?? 0
        analyzedSoFar += data.analyzedCount ?? rows.length

        // Lift each row up to the parent so the spike list updates immediately
        // (the API also persists to the DB, so this just synchronizes the
        // in-memory view with what's been written).
        for (const row of rows) {
          onAnalysisComplete(`${row.matter_unique_id}__${row.week_start}`, {
            primary_event: row.primary_event,
            secondary_events: row.secondary_events ?? [],
            narrative: row.narrative ?? "",
            evidence_quotes: row.evidence_quotes ?? [],
            analyzed_at: new Date().toISOString(),
          })
        }

        setPerSpike([...accumulated])
        setAnalyzedCount(analyzedSoFar)
        setTotalActivities(activitiesSeen)
        setProgress({
          current: Math.min(total, analyzedSoFar),
          total,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  // Build aggregate client-side from accumulated per-spike rows + the original
  // spike billables. Each batch's API response already includes a per-batch
  // aggregate but they're scoped to that batch; rolling up here gives the
  // user the firm-wide view they want.
  const aggregate: AggregateInsight[] = (() => {
    if (perSpike.length === 0) return []
    const by = new Map<
      string,
      { spike_count: number; total_billable: number; matters: Set<string> }
    >()
    for (const row of perSpike) {
      const event = row.primary_event
      const key = `${row.matter_unique_id}__${row.week_start}`
      const billable = billableByKey.get(key) ?? 0
      const cur = by.get(event)
      if (cur) {
        cur.spike_count++
        cur.total_billable += billable
        cur.matters.add(row.display_number)
      } else {
        by.set(event, {
          spike_count: 1,
          total_billable: billable,
          matters: new Set([row.display_number]),
        })
      }
    }
    return Array.from(by.entries())
      .map(([event_type, v]) => ({
        event_type,
        spike_count: v.spike_count,
        total_billable: v.total_billable,
        example_matters: Array.from(v.matters).slice(0, 4),
        pattern_notes: "",
      }))
      .sort((a, b) => b.total_billable - a.total_billable)
  })()

  const palette = new Map<string, string>()
  for (const a of aggregate) colorFor(a.event_type, palette)
  const maxAggregateBillable = aggregate.length > 0
    ? Math.max(1, ...aggregate.map((a) => a.total_billable))
    : 1

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-start gap-2 text-left flex-1"
          >
            {open ? (
              <ChevronDown className="size-4 mt-0.5" />
            ) : (
              <ChevronRight className="size-4 mt-0.5" />
            )}
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="size-4 text-violet-700" />
                AI Spike Event Analysis
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Reads the actual activity descriptions from the top 50 spikes and
                classifies the underlying event (deposition, trial week, mediation,
                discovery cycle, etc.) — not just keywords. Uses Claude. Runs in
                batches of {BATCH_SIZE} so the request never times out and
                progress is visible. Each row is saved to the database as it
                completes.
              </p>
            </div>
          </button>
          {open && (
            <Button
              type="button"
              size="sm"
              onClick={runAnalysis}
              disabled={loading}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {progress
                    ? `Batch ${Math.ceil(progress.current / BATCH_SIZE)} / ${Math.ceil(progress.total / BATCH_SIZE)}…`
                    : "Analyzing…"}
                </>
              ) : perSpike.length > 0 ? (
                "Re-analyze"
              ) : (
                "Run analysis"
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 break-all">
              {error}
            </div>
          )}

          {!perSpike.length && !loading && !error && (
            <p className="text-sm text-muted-foreground">
              Click <strong>Run analysis</strong> to send the top {inScope.length}{" "}
              spike weeks to Claude in batches of {BATCH_SIZE}. Each batch finishes
              in 10–20s; results stream into the table below as batches complete and
              are saved to the database. Roughly a few cents per run.
            </p>
          )}

          {loading && progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Analyzing batch {Math.ceil(progress.current / BATCH_SIZE)} of{" "}
                  {Math.ceil(progress.total / BATCH_SIZE)} —{" "}
                  {progress.current} / {progress.total} spikes complete
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {((progress.current / Math.max(1, progress.total)) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all"
                  style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
            </div>
          )}

          {perSpike.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground">
                Analyzed {analyzedCount.toLocaleString()} spike weeks across{" "}
                {totalActivities.toLocaleString()} activity records.{" "}
                Aggregate event types and per-spike rows below; all saved to the database.
              </div>

              {/* Aggregate event taxonomy (recomputed across all batches) */}
              <section>
                <h3 className="font-semibold text-sm mb-2">Event taxonomy</h3>
                <div className="space-y-2">
                  {aggregate.map((a) => {
                    const cls = colorFor(a.event_type, palette)
                    const widthPct = (a.total_billable / maxAggregateBillable) * 100
                    return (
                      <div key={a.event_type} className="border rounded-md p-3 bg-background">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
                          >
                            {a.event_type}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatNumber(a.spike_count)} spike{a.spike_count === 1 ? "" : "s"} ·{" "}
                            <span className="font-semibold text-foreground">
                              {formatCurrency(a.total_billable)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500/70"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        {a.example_matters.length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-2">
                            Examples:{" "}
                            <span className="font-mono">
                              {a.example_matters.slice(0, 4).join(", ")}
                            </span>
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Per-spike classifications */}
              <section>
                <h3 className="font-semibold text-sm mb-2">
                  Per-spike classification ({perSpike.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="pr-3 py-2 font-medium">Matter</th>
                        <th className="pr-3 py-2 font-medium">Week</th>
                        <th className="pr-3 py-2 font-medium">Event</th>
                        <th className="pr-3 py-2 font-medium">What happened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perSpike.map((s, i) => (
                        <tr
                          key={`${s.matter_unique_id}-${s.week_start}-${i}`}
                          className="border-b align-top"
                        >
                          <td className="pr-3 py-2 font-mono text-[10px]">
                            {s.display_number}
                          </td>
                          <td className="pr-3 py-2 font-mono text-[10px]">
                            {s.week_start}
                          </td>
                          <td className="pr-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${colorFor(
                                s.primary_event,
                                palette,
                              )}`}
                            >
                              {s.primary_event}
                            </span>
                            {s.secondary_events.length > 0 && (
                              <span className="block text-[10px] text-muted-foreground mt-1">
                                + {s.secondary_events.join(", ")}
                              </span>
                            )}
                          </td>
                          <td className="pr-3 py-2 text-muted-foreground">
                            <p>{s.narrative}</p>
                            {s.evidence_quotes.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {s.evidence_quotes.slice(0, 3).map((q, j) => (
                                  <li
                                    key={j}
                                    className="text-[10px] italic text-muted-foreground"
                                  >
                                    &ldquo;{q}&rdquo;
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
