"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, BrainCircuit, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import type { SpikeRow, StoredSpikeAnalysis } from "@/app/(dashboard)/activity-spikes/page"

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
  inputCount: number
  executive_summary: string
  surcharge_tiers: SurchargeTier[]
  thematic_clusters: ThematicCluster[]
  lifecycle_insights: { stage: string; observation: string }[]
  attorney_observations: string
  risk_flags: string[]
  recommended_next_steps: string[]
}

interface Props {
  /** All spikes (filtered or not) so we can pull billable / ratio / lifecycle for any analyzed row. */
  spikes: SpikeRow[]
  /** Live in-session analyses — overrides the SSR-loaded storedAnalysis when present. */
  sessionAnalyses: Map<string, StoredSpikeAnalysis>
}

export function SpikeMetaDashboard({ spikes, sessionAnalyses }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MetaAnalysisResult | null>(null)
  const [activeEvent, setActiveEvent] = useState<string | null>(null)

  // Build the input set from any spike that has a classification (stored or live).
  const classified = useMemo(() => {
    const out: Array<{ spike: SpikeRow; analysis: StoredSpikeAnalysis }> = []
    for (const s of spikes) {
      const key = `${s.matter_unique_id}__${s.week_start}`
      const a = sessionAnalyses.get(key) ?? s.storedAnalysis
      if (a) out.push({ spike: s, analysis: a })
    }
    return out
  }, [spikes, sessionAnalyses])

  // Per-event drill-down list (only useful after a meta result exists).
  const spikesByEvent = useMemo(() => {
    const map = new Map<string, Array<{ spike: SpikeRow; analysis: StoredSpikeAnalysis }>>()
    for (const c of classified) {
      const arr = map.get(c.analysis.primary_event)
      if (arr) arr.push(c)
      else map.set(c.analysis.primary_event, [c])
    }
    return map
  }, [classified])

  const runMeta = async () => {
    if (classified.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const payload = classified.map(({ spike, analysis }) => ({
        matter_unique_id: spike.matter_unique_id,
        week_start: spike.week_start,
        display_number: spike.display_number,
        client_display: spike.client_display,
        billable: spike.billable,
        ratio: Number.isFinite(spike.ratio) ? spike.ratio : 0,
        hours: spike.hours,
        lifecycleStage: spike.lifecycleStage,
        mapped_category: spike.mapped_category,
        primary_event: analysis.primary_event,
        secondary_events: analysis.secondary_events,
        narrative: analysis.narrative,
      }))
      const res = await fetch("/api/meta-spike-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classifiedSpikes: payload }),
      })
      const text = await res.text()
      let data: MetaAnalysisResult & { error?: string }
      try {
        data = JSON.parse(text)
      } catch {
        setError(`Server returned non-JSON: ${text.slice(0, 200)}`)
        return
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const totalRevenueImpact = result
    ? result.surcharge_tiers.reduce((s, t) => s + t.estimated_annual_revenue, 0)
    : 0

  const maxTierRevenue = result
    ? Math.max(1, ...result.surcharge_tiers.map((t) => t.estimated_annual_revenue))
    : 1

  return (
    <Card className="border-indigo-200 bg-indigo-50/30">
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
                <BrainCircuit className="size-4 text-indigo-700" />
                Meta-analysis: surcharge strategy
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Sends every classified spike (currently{" "}
                <span className="font-semibold">{classified.length}</span>) back to
                Claude for a second-pass strategic review: recommended surcharge tiers
                with dollar amounts, thematic clusters, lifecycle correlations, and
                risk flags. Click into any event in the results to drill into the
                underlying spikes.
              </p>
            </div>
          </button>
          {open && (
            <Button
              type="button"
              size="sm"
              onClick={runMeta}
              disabled={loading || classified.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Synthesizing…
                </>
              ) : result ? (
                "Re-analyze"
              ) : (
                "Run meta-analysis"
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-6">
          {classified.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No classified spikes yet. Run the bulk &ldquo;AI Spike Event
              Analysis&rdquo; above first, or click &ldquo;Analyze this spike&rdquo;
              on individual rows. Once at least 5–10 spikes are classified the
              meta-analysis becomes useful.
            </p>
          )}

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 break-all">
              {error}
            </div>
          )}

          {result && (
            <>
              {/* Executive summary */}
              <section>
                <h3 className="font-semibold text-sm mb-1">Executive summary</h3>
                <p className="text-sm leading-relaxed">{result.executive_summary}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Synthesized from {result.inputCount.toLocaleString()} classified spikes.
                  Estimated combined annual revenue impact if all surcharge tiers are
                  adopted: <strong>{formatCurrency(totalRevenueImpact)}</strong>.
                </p>
              </section>

              {/* Surcharge tiers — interactive */}
              <section>
                <h3 className="font-semibold text-sm mb-2">Recommended surcharge tiers</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Click a row to expand the spikes that informed it.
                </p>
                <div className="space-y-2">
                  {[...result.surcharge_tiers]
                    .sort((a, b) => b.estimated_annual_revenue - a.estimated_annual_revenue)
                    .map((t) => {
                      const widthPct = (t.estimated_annual_revenue / maxTierRevenue) * 100
                      const matches = spikesByEvent.get(t.event_type) ?? []
                      const isActive = activeEvent === t.event_type
                      return (
                        <div
                          key={t.event_type}
                          className={`rounded-md border bg-background ${
                            isActive ? "border-indigo-400 ring-1 ring-indigo-200" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveEvent(isActive ? null : t.event_type)}
                            className="w-full text-left p-3 hover:bg-muted/30"
                          >
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-3 flex-wrap">
                                <span className="inline-flex rounded-full border border-indigo-300 bg-indigo-100 text-indigo-900 px-2.5 py-0.5 text-xs font-semibold">
                                  {t.event_type}
                                </span>
                                <span className="text-sm font-bold text-foreground tabular-nums">
                                  +{formatCurrency(t.recommended_surcharge)}/event
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatNumber(t.spike_frequency)} historical occurrences
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                est. annual:{" "}
                                <span className="font-semibold text-foreground">
                                  {formatCurrency(t.estimated_annual_revenue)}
                                </span>
                              </div>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-indigo-500/70"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                              {t.rationale}
                            </p>
                            {t.caveats.length > 0 && (
                              <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700">
                                {t.caveats.map((c, i) => (
                                  <li key={i}>⚠ {c}</li>
                                ))}
                              </ul>
                            )}
                          </button>
                          {isActive && matches.length > 0 && (
                            <div className="border-t border-border bg-muted/20 p-3">
                              <p className="text-[11px] text-muted-foreground mb-2">
                                {matches.length} classified spikes informed this tier:
                              </p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-[11px]">
                                  <thead>
                                    <tr className="text-left text-muted-foreground border-b">
                                      <th className="pr-3 py-1">Matter</th>
                                      <th className="pr-3 py-1">Week</th>
                                      <th className="pr-3 py-1 text-right">Billable</th>
                                      <th className="pr-3 py-1 text-right">Ratio</th>
                                      <th className="pr-3 py-1">What happened</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {matches.slice(0, 30).map((m, i) => (
                                      <tr key={i} className="border-b border-border/40 align-top">
                                        <td className="pr-3 py-1 font-mono">
                                          {m.spike.display_number}
                                        </td>
                                        <td className="pr-3 py-1 font-mono">
                                          {m.spike.week_start}
                                        </td>
                                        <td className="pr-3 py-1 text-right tabular-nums">
                                          {formatCurrency(m.spike.billable)}
                                        </td>
                                        <td className="pr-3 py-1 text-right tabular-nums">
                                          {Number.isFinite(m.spike.ratio)
                                            ? `${m.spike.ratio.toFixed(1)}×`
                                            : "—"}
                                        </td>
                                        <td className="pr-3 py-1 text-muted-foreground">
                                          {m.analysis.narrative}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {matches.length > 30 && (
                                  <p className="text-[11px] text-muted-foreground mt-1">
                                    + {matches.length - 30} more
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </section>

              {/* Thematic clusters */}
              {result.thematic_clusters.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Thematic clusters</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {result.thematic_clusters.map((c) => (
                      <div
                        key={c.cluster_name}
                        className="rounded-md border bg-background p-3"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                          <span className="font-semibold text-sm">{c.cluster_name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatNumber(c.spike_count)} spike
                            {c.spike_count === 1 ? "" : "s"} ·{" "}
                            <span className="font-semibold text-foreground">
                              {formatCurrency(c.total_billable)}
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {c.events_in_cluster.map((e) => (
                            <span
                              key={e}
                              className="inline-flex rounded-full border bg-muted px-1.5 py-0.5 text-[10px]"
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {c.insight}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Lifecycle insights */}
              {result.lifecycle_insights.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Lifecycle insights</h3>
                  <ul className="space-y-1.5 text-xs">
                    {result.lifecycle_insights.map((l) => (
                      <li key={l.stage} className="flex items-start gap-2">
                        <span className="font-semibold w-32 shrink-0">{l.stage}:</span>
                        <span className="text-muted-foreground">{l.observation}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Attorney observations */}
              {result.attorney_observations && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Attorney observations</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {result.attorney_observations}
                  </p>
                </section>
              )}

              {/* Risk flags */}
              {result.risk_flags.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="size-4 text-amber-600" />
                    Risk flags
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {result.risk_flags.map((f, i) => (
                      <li key={i} className="text-amber-800">
                        ⚠ {f}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Next steps */}
              {result.recommended_next_steps.length > 0 && (
                <section>
                  <h3 className="font-semibold text-sm mb-2">Recommended next steps</h3>
                  <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
                    {result.recommended_next_steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
