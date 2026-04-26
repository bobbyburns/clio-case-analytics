"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, ChevronDown, ChevronRight } from "lucide-react"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import type { SpikeRow } from "@/app/(dashboard)/activity-spikes/page"

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

interface AnalysisResult {
  analyzedCount: number
  totalActivities: number
  spikes: SpikeAnalysisRow[]
  aggregate: AggregateInsight[]
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

interface Props {
  topSpikes: SpikeRow[]
}

export function SpikeEventAnalysis({ topSpikes }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = topSpikes.slice(0, 50).map((s) => ({
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
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const palette = new Map<string, string>()
  if (result) {
    // Pre-assign colors in aggregate order so legend matches the bars.
    for (const a of result.aggregate) colorFor(a.event_type, palette)
  }

  const maxAggregateBillable = result
    ? Math.max(1, ...result.aggregate.map((a) => a.total_billable))
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
                discovery cycle, etc.) — not just keywords. Uses Claude.
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
                  Analyzing…
                </>
              ) : result ? (
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
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!result && !loading && !error && (
            <p className="text-sm text-muted-foreground">
              Click <strong>Run analysis</strong> to send the top 50 spike weeks (with
              their underlying activity records) to Claude. The model will infer the
              actual event type behind each spike (e.g. &ldquo;Deposition&rdquo;,
              &ldquo;Trial Week&rdquo;, &ldquo;Discovery Response Cycle&rdquo;) and
              return a per-spike classification plus an aggregate event taxonomy. This
              call typically takes 20–60 seconds and costs roughly a few cents.
            </p>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Fetching {topSpikes.slice(0, 50).length} spike weeks of activities and
              running classification…
            </div>
          )}

          {result && (
            <>
              <div className="text-xs text-muted-foreground">
                Analyzed {result.analyzedCount.toLocaleString()} spike weeks across{" "}
                {result.totalActivities.toLocaleString()} activity records.
              </div>

              {/* Aggregate event taxonomy */}
              <section>
                <h3 className="font-semibold text-sm mb-2">Event taxonomy</h3>
                <div className="space-y-2">
                  {result.aggregate
                    .sort((a, b) => b.total_billable - a.total_billable)
                    .map((a) => {
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
                          <p className="text-xs text-muted-foreground mt-2">
                            {a.pattern_notes}
                          </p>
                          {a.example_matters.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-1">
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
                  Per-spike classification ({result.spikes.length})
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
                      {result.spikes.map((s, i) => (
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
