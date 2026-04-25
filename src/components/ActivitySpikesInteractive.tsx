"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { KPICard } from "@/components/charts/KPICard"
import { FirmWeeklyBillableChart } from "@/components/charts/ActivitySpikesCharts"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { tokenizeTriggers, type TriggerKeyword } from "@/lib/spikes"
import type { SpikeRow } from "@/app/(dashboard)/activity-spikes/page"
import type { SpikeActivityRow } from "@/lib/queries"

interface KpiBundle {
  spikeCount: number
  totalFirmBillable: number
  totalSpikeBillable: number
  mattersWithSpike: number
  totalMatters: number
  medianRatio: number
  sparseCount: number
  ratioCount: number
}

interface Props {
  spikes: SpikeRow[]
  firmWeekly: Array<{ week: string; billable: number; rolling4: number }>
  spikeWeekSet: string[]
  initialRatio: number
  initialFloor: number
  kpis: KpiBundle
}

export function ActivitySpikesInteractive({
  spikes,
  firmWeekly,
  spikeWeekSet,
  initialRatio,
  initialFloor,
  kpis,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [ratio, setRatio] = useState(initialRatio)
  const [ratioInput, setRatioInput] = useState(String(initialRatio))
  const [floor, setFloor] = useState(initialFloor)
  const [floorInput, setFloorInput] = useState(String(initialFloor))

  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [drilldownByKey, setDrilldownByKey] = useState<Record<string, SpikeActivityRow[]>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [drillError, setDrillError] = useState<string | null>(null)

  const syncToUrl = useCallback(
    (overrides: { ratio?: number; floor?: number }) => {
      const p = new URLSearchParams(searchParams.toString())
      const r = overrides.ratio ?? ratio
      const f = overrides.floor ?? floor
      if (Math.abs(r - 2.5) < 0.01) p.delete("ratio")
      else p.set("ratio", String(r))
      if (f === 250) p.delete("floor")
      else p.set("floor", String(f))
      router.replace(`${pathname}?${p.toString()}`)
    },
    [router, pathname, searchParams, ratio, floor],
  )

  const spikeWeekLookup = useMemo(() => new Set(spikeWeekSet), [spikeWeekSet])

  const toggleExpand = useCallback(
    async (matterId: string, weekStart: string) => {
      const key = `${matterId}__${weekStart}`
      if (expandedKey === key) {
        setExpandedKey(null)
        return
      }
      setExpandedKey(key)
      setDrillError(null)
      if (drilldownByKey[key]) return
      setLoadingKey(key)
      try {
        const res = await fetch(
          `/api/spike-activities?matterId=${encodeURIComponent(matterId)}&weekStart=${encodeURIComponent(weekStart)}`,
        )
        const data = await res.json()
        if (!res.ok) {
          setDrillError(data.error ?? `HTTP ${res.status}`)
        } else {
          setDrilldownByKey((prev) => ({ ...prev, [key]: data.activities ?? [] }))
        }
      } catch (e) {
        setDrillError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoadingKey(null)
      }
    },
    [expandedKey, drilldownByKey],
  )

  // Trigger keywords are computed across the union of activities currently
  // loaded into the drill-down cache. Initially this leaderboard is empty;
  // it grows as the user expands rows. This keeps page load fast (no extra
  // round-trip to fetch every spike's activities up front) while still
  // letting the user accumulate trigger evidence.
  const triggerKeywords: TriggerKeyword[] = useMemo(() => {
    const all: SpikeActivityRow[] = []
    for (const arr of Object.values(drilldownByKey)) all.push(...arr)
    return tokenizeTriggers(all).slice(0, 25)
  }, [drilldownByKey])

  const expenseCategoryTally = useMemo(() => {
    const tally = new Map<string, { count: number; total: number }>()
    for (const arr of Object.values(drilldownByKey)) {
      for (const a of arr) {
        const key = a.expense_category ?? "—"
        const cur = tally.get(key)
        if (cur) {
          cur.count++
          cur.total += a.billable_amount
        } else {
          tally.set(key, { count: 1, total: a.billable_amount })
        }
      }
    }
    return Array.from(tally.entries())
      .map(([category, v]) => ({ category, count: v.count, total: v.total }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [drilldownByKey])

  const typeTally = useMemo(() => {
    let timeCount = 0
    let expenseCount = 0
    let timeTotal = 0
    let expenseTotal = 0
    for (const arr of Object.values(drilldownByKey)) {
      for (const a of arr) {
        if (a.type === "TimeEntry") {
          timeCount++
          timeTotal += a.billable_amount
        } else {
          expenseCount++
          expenseTotal += a.billable_amount
        }
      }
    }
    return { timeCount, expenseCount, timeTotal, expenseTotal }
  }, [drilldownByKey])

  const drilldownRowsLoaded = Object.keys(drilldownByKey).length

  return (
    <div className="space-y-6">
      {/* Detection knobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Spike Detection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Spike ratio (×&nbsp;matter median)
                </Label>
                <span className="text-sm font-semibold">{ratio.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={1.5}
                max={5}
                step={0.1}
                value={ratio}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setRatio(v)
                  setRatioInput(String(v))
                }}
                onMouseUp={(e) =>
                  syncToUrl({ ratio: Number((e.target as HTMLInputElement).value) })
                }
                onTouchEnd={(e) =>
                  syncToUrl({ ratio: Number((e.target as HTMLInputElement).value) })
                }
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>1.5×</span>
                <span>2.5×</span>
                <span>3.5×</span>
                <span>5×</span>
              </div>
              <Input
                type="number"
                min={1}
                max={10}
                step={0.1}
                className="w-32 h-9 mt-1"
                value={ratioInput}
                onChange={(e) => setRatioInput(e.target.value)}
                onBlur={() => {
                  const v = Math.max(1, Math.min(10, Number(ratioInput) || 2.5))
                  setRatio(v)
                  setRatioInput(String(v))
                  syncToUrl({ ratio: v })
                }}
              />
            </div>

            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Absolute floor (week billable ≥)
                </Label>
                <span className="text-sm font-semibold">{formatCurrency(floor)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={5000}
                step={50}
                value={floor}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setFloor(v)
                  setFloorInput(String(v))
                }}
                onMouseUp={(e) =>
                  syncToUrl({ floor: Number((e.target as HTMLInputElement).value) })
                }
                onTouchEnd={(e) =>
                  syncToUrl({ floor: Number((e.target as HTMLInputElement).value) })
                }
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>$0</span>
                <span>$1k</span>
                <span>$2.5k</span>
                <span>$5k</span>
              </div>
              <Input
                type="number"
                min={0}
                step={50}
                className="w-32 h-9 mt-1"
                value={floorInput}
                onChange={(e) => setFloorInput(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Math.min(50000, Number(floorInput) || 0))
                  setFloor(v)
                  setFloorInput(String(v))
                  syncToUrl({ floor: v })
                }}
              />
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            A matter-week is a spike if both <em>billable ≥ ratio × matter median</em> AND{" "}
            <em>billable ≥ floor</em>. Matters with fewer than 8 weeks of activity (or median
            of 0) fall back to the absolute floor only.
          </p>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Spikes detected"
          value={formatNumber(kpis.spikeCount)}
          trend={`${formatNumber(kpis.ratioCount)} ratio · ${formatNumber(kpis.sparseCount)} sparse`}
        />
        <KPICard
          label="Spike $ as % of firm"
          value={
            kpis.totalFirmBillable > 0
              ? `${((kpis.totalSpikeBillable / kpis.totalFirmBillable) * 100).toFixed(1)}%`
              : "—"
          }
          trend={`${formatCurrency(kpis.totalSpikeBillable)} spike billable`}
        />
        <KPICard
          label="Matters with ≥1 spike"
          value={`${formatNumber(kpis.mattersWithSpike)} / ${formatNumber(kpis.totalMatters)}`}
          trend={
            kpis.totalMatters > 0
              ? `${((kpis.mattersWithSpike / kpis.totalMatters) * 100).toFixed(0)}% of in-scope matters`
              : ""
          }
        />
        <KPICard
          label="Median spike ratio"
          value={`${kpis.medianRatio.toFixed(2)}×`}
          trend="across ratio-based spikes"
        />
      </div>

      {/* Firm-wide weekly chart */}
      <FirmWeeklyBillableChart data={firmWeekly} spikeWeeks={spikeWeekLookup} />

      {/* Spike list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Spike list ({formatNumber(spikes.length)})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ranked by week billable. Click a row to load the activities for that week.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Matter</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Week of</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead className="text-right">Baseline median</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Activities</TableHead>
                <TableHead>Rule</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spikes.slice(0, 200).map((s) => {
                const key = `${s.matter_unique_id}__${s.week_start}`
                const isExpanded = expandedKey === key
                const drilldown = drilldownByKey[key]
                const isLoading = loadingKey === key
                return (
                  <SpikeRowExpander
                    key={key}
                    rowKey={key}
                    spike={s}
                    isExpanded={isExpanded}
                    isLoading={isLoading}
                    drilldown={drilldown}
                    drillError={isExpanded ? drillError : null}
                    onToggle={() => toggleExpand(s.matter_unique_id, s.week_start)}
                  />
                )
              })}
            </TableBody>
          </Table>
          {spikes.length > 200 && (
            <p className="px-4 py-3 text-xs text-muted-foreground border-t">
              Showing top 200 of {formatNumber(spikes.length)} spikes by billable amount.
              Tighten the ratio or floor to narrow the list.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Trigger leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trigger Leaderboard</CardTitle>
          <p className="text-xs text-muted-foreground">
            Computed across the spike rows you&rsquo;ve expanded. Open more rows above
            to grow the keyword sample. Currently sampling {drilldownRowsLoaded.toLocaleString()}{" "}
            spike-week{drilldownRowsLoaded === 1 ? "" : "s"}.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Top description keywords
              </h3>
              {triggerKeywords.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Expand a spike row to see keywords.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {triggerKeywords.map((k) => (
                    <li key={k.keyword} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{k.keyword}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {k.count.toLocaleString()} ·{" "}
                        {formatCurrency(k.totalBillable)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Top expense categories
              </h3>
              {expenseCategoryTally.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Expand a spike row to populate.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {expenseCategoryTally.map((c) => (
                    <li key={c.category} className="flex items-center justify-between gap-2">
                      <span>{c.category}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {c.count.toLocaleString()} · {formatCurrency(c.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Type split
              </h3>
              {typeTally.timeCount + typeTally.expenseCount === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Expand a spike row to populate.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  <li className="flex items-center justify-between gap-2">
                    <span>TimeEntry</span>
                    <span className="text-muted-foreground tabular-nums">
                      {typeTally.timeCount.toLocaleString()} ·{" "}
                      {formatCurrency(typeTally.timeTotal)}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>ExpenseEntry</span>
                    <span className="text-muted-foreground tabular-nums">
                      {typeTally.expenseCount.toLocaleString()} ·{" "}
                      {formatCurrency(typeTally.expenseTotal)}
                    </span>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SpikeRowExpander({
  rowKey,
  spike,
  isExpanded,
  isLoading,
  drilldown,
  drillError,
  onToggle,
}: {
  rowKey: string
  spike: SpikeRow & {
    display_number: string
    client_display: string
    mapped_category: string | null
  }
  isExpanded: boolean
  isLoading: boolean
  drilldown: SpikeActivityRow[] | undefined
  drillError: string | null
  onToggle: () => void
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={onToggle}
      >
        <TableCell>
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="font-mono text-xs">{spike.display_number}</TableCell>
        <TableCell className="text-sm">{spike.client_display}</TableCell>
        <TableCell className="font-mono text-xs">{spike.week_start}</TableCell>
        <TableCell className="text-right tabular-nums font-medium">
          {formatCurrency(spike.billable)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {spike.baselineMedian > 0 ? formatCurrency(spike.baselineMedian) : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {Number.isFinite(spike.ratio) ? `${spike.ratio.toFixed(1)}×` : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums">{spike.hours.toFixed(1)}</TableCell>
        <TableCell className="text-right tabular-nums">{spike.activity_count}</TableCell>
        <TableCell>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
              spike.rule === "ratio"
                ? "bg-blue-50 text-blue-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {spike.rule}
          </span>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow>
          <TableCell colSpan={10} className="bg-muted/30 p-4">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading activities…
              </div>
            ) : drillError ? (
              <p className="text-sm text-rose-700">Error: {drillError}</p>
            ) : drilldown && drilldown.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-3 py-1">Date</th>
                      <th className="pr-3 py-1">Type</th>
                      <th className="pr-3 py-1">User</th>
                      <th className="pr-3 py-1">Description</th>
                      <th className="pr-3 py-1 text-right">Hours</th>
                      <th className="pr-3 py-1 text-right">Rate</th>
                      <th className="pr-3 py-1 text-right">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldown.map((a, i) => (
                      <tr key={`${rowKey}-${i}`} className="border-t border-border/40">
                        <td className="pr-3 py-1 font-mono">{a.activity_date ?? "—"}</td>
                        <td className="pr-3 py-1">
                          {a.type === "TimeEntry" ? "Time" : "Expense"}
                        </td>
                        <td className="pr-3 py-1">{a.user_name ?? "—"}</td>
                        <td
                          className="pr-3 py-1 max-w-md"
                          title={a.description ?? ""}
                        >
                          <span className="block truncate">{a.description ?? "—"}</span>
                        </td>
                        <td className="pr-3 py-1 text-right tabular-nums">{a.hours.toFixed(2)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums">{formatCurrency(a.rate)}</td>
                        <td className="pr-3 py-1 text-right tabular-nums font-medium">
                          {formatCurrency(a.billable_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No activity records returned for this matter-week.
              </p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
