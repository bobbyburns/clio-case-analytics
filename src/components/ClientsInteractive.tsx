"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TrendingUp, TrendingDown, Minus, X, ChevronRight, ChevronDown, Loader2 } from "lucide-react"
import { KPICard } from "@/components/charts/KPICard"
import { BreakEvenExplainer } from "@/components/BreakEvenExplainer"
import {
  RevenueDensityHistogram,
  WinnersLosersHistogram,
} from "@/components/charts/PricingModelCharts"
import { formatCurrency } from "@/lib/utils/format"
import { mean, median } from "@/lib/utils/stats"
import { densityHistogram, deltaHistogram } from "@/lib/utils/pricing"
import type { ClientRow, EngagementType, ClientMatter } from "@/app/(dashboard)/clients/page"
import type { Activity } from "@/lib/types"

type SortKey =
  | "display"
  | "totalBillable"
  | "monthsActive"
  | "avgPerMonth"
  | "matterCount"
  | "delta"
  | "engagementType"
type ScenarioFilter = "all" | "winners" | "losers"

/** Logical (not alphabetical) sort order for the Type column. */
const ENGAGEMENT_SORT_ORDER: Record<EngagementType, number> = {
  ongoing: 0,
  "short-burst": 1,
  "flat-fee": 2,
  "single-activity": 3,
  unlogged: 4,
  "legacy-migration": 5,
}

const ENGAGEMENT_TYPES: EngagementType[] = [
  "ongoing",
  "short-burst",
  "flat-fee",
  "single-activity",
  "unlogged",
  "legacy-migration",
]

interface ScenarioRow extends ClientRow {
  activeMonthsCeil: number
  hypothetical: number
  delta: number
  isWinner: boolean
}

interface Props {
  rows: ClientRow[]
  initialRetainer: number
  initialFirstFrom: string
  initialFirstTo: string
  initialOpenFrom: string
  initialOpenTo: string
  initialTypes: string[]
}

export function ClientsInteractive({
  rows,
  initialRetainer,
  initialFirstFrom,
  initialFirstTo,
  initialOpenFrom,
  initialOpenTo,
  initialTypes,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [retainer, setRetainer] = useState(initialRetainer)
  const [retainerInput, setRetainerInput] = useState(String(initialRetainer))
  const [firstFrom, setFirstFrom] = useState(initialFirstFrom)
  const [firstTo, setFirstTo] = useState(initialFirstTo)
  const [openFrom, setOpenFrom] = useState(initialOpenFrom)
  const [openTo, setOpenTo] = useState(initialOpenTo)
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioFilter>("all")
  const [typeFilter, setTypeFilter] = useState<Set<EngagementType>>(
    () =>
      new Set(
        initialTypes.filter((t): t is EngagementType =>
          (ENGAGEMENT_TYPES as string[]).includes(t),
        ),
      ),
  )
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("totalBillable")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [limit, setLimit] = useState(100)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [activitiesByKey, setActivitiesByKey] = useState<Record<string, Activity[]>>({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)

  const toggleExpand = useCallback(
    async (clientKey: string, matters: ClientMatter[]) => {
      if (expandedKey === clientKey) {
        setExpandedKey(null)
        return
      }
      setExpandedKey(clientKey)
      if (!activitiesByKey[clientKey]) {
        setLoadingKey(clientKey)
        try {
          const results = await Promise.all(
            matters.map((m) =>
              fetch(`/api/activities?matterId=${encodeURIComponent(m.unique_id)}`)
                .then((r) => r.json())
                .then((data) => (data.activities as Activity[]) ?? [])
                .catch(() => [] as Activity[]),
            ),
          )
          const merged = results.flat()
          merged.sort((a, b) =>
            (a.activity_date || "").localeCompare(b.activity_date || ""),
          )
          setActivitiesByKey((prev) => ({ ...prev, [clientKey]: merged }))
        } catch {
          setActivitiesByKey((prev) => ({ ...prev, [clientKey]: [] }))
        }
        setLoadingKey(null)
      }
    },
    [expandedKey, activitiesByKey],
  )

  const syncRetainerToUrl = useCallback(
    (value: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value !== 1500) params.set("retainer", String(value))
      else params.delete("retainer")
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const syncCohortToUrl = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (from) params.set("firstFrom", from)
      else params.delete("firstFrom")
      if (to) params.set("firstTo", to)
      else params.delete("firstTo")
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const syncOpenToUrl = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (from) params.set("openFrom", from)
      else params.delete("openFrom")
      if (to) params.set("openTo", to)
      else params.delete("openTo")
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const syncTypesToUrl = useCallback(
    (types: Set<EngagementType>) => {
      const params = new URLSearchParams(searchParams.toString())
      if (types.size > 0) params.set("types", Array.from(types).join(","))
      else params.delete("types")
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  /** Does this client have any matter with open_date in the [from, to] range? */
  const matterOpenInRange = useCallback(
    (r: ClientRow, from: string, to: string) => {
      if (!from && !to) return true
      for (const m of r.matters) {
        if (!m.open_date) continue
        if (from && m.open_date < from) continue
        if (to && m.open_date > to) continue
        return true
      }
      return false
    },
    [],
  )

  // Cohort filter: narrows by first-appearance date, matter-open date, AND engagement type.
  // firstAppearance falls back to earliest matter open_date for clients with zero activities,
  // so brand-new unlogged clients aren't silently dropped.
  const cohortRows = useMemo(() => {
    let list = rows
    if (firstFrom || firstTo) {
      list = list.filter((r) => {
        const ref = r.firstAppearance
        if (!ref) return false
        if (firstFrom && ref < firstFrom) return false
        if (firstTo && ref > firstTo) return false
        return true
      })
    }
    if (openFrom || openTo) {
      list = list.filter((r) => matterOpenInRange(r, openFrom, openTo))
    }
    if (typeFilter.size > 0) {
      list = list.filter((r) => typeFilter.has(r.engagementType))
    }
    return list
  }, [rows, firstFrom, firstTo, openFrom, openTo, typeFilter, matterOpenInRange])

  const scenarioRows = useMemo<ScenarioRow[]>(() => {
    return cohortRows.map((r) => {
      const activeMonthsCeil = Math.max(1, Math.ceil(r.monthsActive))
      const hypothetical = activeMonthsCeil * retainer
      const delta = hypothetical - r.totalBillable
      return {
        ...r,
        activeMonthsCeil,
        hypothetical,
        delta,
        isWinner: delta > 0,
      }
    })
  }, [cohortRows, retainer])

  const summary = useMemo(() => {
    const totalActual = scenarioRows.reduce((s, r) => s + r.totalBillable, 0)
    const totalHypothetical = scenarioRows.reduce((s, r) => s + r.hypothetical, 0)
    const winners = scenarioRows.filter((r) => r.delta > 0)
    const losers = scenarioRows.filter((r) => r.delta < 0)
    const revenueCaptured = winners.reduce((s, r) => s + r.delta, 0)
    const revenueAtRisk = losers.reduce((s, r) => s + -r.delta, 0)
    const totalMonthsCeil = scenarioRows.reduce((s, r) => s + r.activeMonthsCeil, 0)
    const totalMonthsRaw = scenarioRows.reduce((s, r) => s + r.monthsActive, 0)
    const densities = scenarioRows
      .filter((r) => r.monthsActive > 0 && r.totalBillable > 0)
      .map((r) => r.totalBillable / r.monthsActive)
    // Break-even uses the raw monthsActive so it's comparable to the per-client $/month values.
    const firmBreakEven = totalMonthsRaw > 0 ? totalActual / totalMonthsRaw : 0
    const medianBreakEven = median(densities)
    const meanBreakEven = mean(densities)

    // Top-10 loser concentration: what % of revenue-at-risk comes from the 10 biggest losers?
    const sortedLosersByImpact = [...losers].sort((a, b) => -a.delta - -b.delta)
    const top10LoserImpact = sortedLosersByImpact
      .slice(0, 10)
      .reduce((s, r) => s + -r.delta, 0)
    const top10LoserShare = revenueAtRisk > 0 ? top10LoserImpact / revenueAtRisk : 0

    // Top-row summary KPIs (also dependent on cohort filter).
    const clientCount = scenarioRows.length
    const totalMatters = scenarioRows.reduce((s, r) => s + r.matterCount, 0)
    const avgRevenuePerClient = clientCount > 0 ? totalActual / clientCount : 0
    const activeRows = scenarioRows.filter((r) => r.monthsActive > 0)
    const avgMonthsActive =
      activeRows.length > 0
        ? activeRows.reduce((s, r) => s + r.monthsActive, 0) / activeRows.length
        : 0
    const avgPerMonthMean =
      activeRows.length > 0
        ? activeRows.reduce((s, r) => s + r.avgPerMonth, 0) / activeRows.length
        : 0
    const weightedAvgPerMonth = totalMonthsRaw > 0 ? totalActual / totalMonthsRaw : 0

    return {
      totalActual,
      totalHypothetical,
      firmDelta: totalHypothetical - totalActual,
      winnerCount: winners.length,
      loserCount: losers.length,
      revenueCaptured,
      revenueAtRisk,
      firmBreakEven,
      medianBreakEven,
      meanBreakEven,
      densities,
      top10LoserShare,
      top10LoserImpact,
      // Top summary
      clientCount,
      totalMatters,
      avgRevenuePerClient,
      avgMonthsActive,
      avgPerMonthMean,
      weightedAvgPerMonth,
      totalMonthsCeil,
    }
  }, [scenarioRows])

  // Counts reflect the date-cohort (not already-type-filtered), so pill counts show
  // "clients available to toggle" — not zero when that type is currently deselected.
  const dateCohortRows = useMemo(() => {
    let list = rows
    if (firstFrom || firstTo) {
      list = list.filter((r) => {
        const ref = r.firstAppearance
        if (!ref) return false
        if (firstFrom && ref < firstFrom) return false
        if (firstTo && ref > firstTo) return false
        return true
      })
    }
    if (openFrom || openTo) {
      list = list.filter((r) => matterOpenInRange(r, openFrom, openTo))
    }
    return list
  }, [rows, firstFrom, firstTo, openFrom, openTo, matterOpenInRange])

  const typeCounts = useMemo(() => {
    const counts: Record<EngagementType, number> = {
      ongoing: 0,
      "short-burst": 0,
      "flat-fee": 0,
      "single-activity": 0,
      unlogged: 0,
      "legacy-migration": 0,
    }
    for (const r of dateCohortRows) counts[r.engagementType]++
    return counts
  }, [dateCohortRows])

  const toggleTypeFilter = useCallback(
    (t: EngagementType) => {
      setTypeFilter((prev) => {
        const next = new Set(prev)
        if (next.has(t)) next.delete(t)
        else next.add(t)
        syncTypesToUrl(next)
        return next
      })
    },
    [syncTypesToUrl],
  )

  const clearTypeFilter = useCallback(() => {
    setTypeFilter(new Set())
    syncTypesToUrl(new Set())
  }, [syncTypesToUrl])

  const densityBuckets = useMemo(
    () => densityHistogram(summary.densities),
    [summary.densities],
  )
  const deltaBuckets = useMemo(
    () => deltaHistogram(scenarioRows.map((r) => r.delta)),
    [scenarioRows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list: ScenarioRow[] = scenarioRows
    if (q) list = list.filter((r) => r.display.toLowerCase().includes(q))
    if (scenarioFilter === "winners") list = list.filter((r) => r.delta > 0)
    else if (scenarioFilter === "losers") list = list.filter((r) => r.delta < 0)

    list = [...list]
    list.sort((a, b) => {
      if (sortKey === "engagementType") {
        const ao = ENGAGEMENT_SORT_ORDER[a.engagementType]
        const bo = ENGAGEMENT_SORT_ORDER[b.engagementType]
        return sortDir === "desc" ? bo - ao : ao - bo
      }
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv)
      }
      return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return list
  }, [scenarioRows, search, scenarioFilter, sortKey, sortDir])

  const visible = filtered.slice(0, limit)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir(key === "display" ? "asc" : "desc")
    }
  }
  const indicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""

  const deltaDirection: "up" | "down" | "neutral" =
    summary.firmDelta > 0 ? "up" : summary.firmDelta < 0 ? "down" : "neutral"

  const firstActive = Boolean(firstFrom || firstTo)
  const openActive = Boolean(openFrom || openTo)
  const cohortActive = firstActive || openActive

  return (
    <div className="space-y-6">
      {/* Top-row summary KPIs (cohort-aware) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard
          label="Clients"
          value={summary.clientCount.toLocaleString()}
          trend={`${summary.totalMatters.toLocaleString()} matters`}
        />
        <KPICard
          label="Total Revenue"
          value={formatCurrency(summary.totalActual)}
          trend={`${formatCurrency(summary.avgRevenuePerClient)} / client avg`}
        />
        <KPICard
          label="Avg Months Active"
          value={summary.avgMonthsActive.toFixed(1)}
          trend="mean per client"
        />
        <KPICard
          label="Avg $ / Active Month"
          value={formatCurrency(summary.avgPerMonthMean)}
          trend="mean of per-client ratios"
        />
        <KPICard
          label="Weighted $ / Month"
          value={formatCurrency(summary.weightedAvgPerMonth)}
          trend="total rev ÷ total months"
        />
      </div>

      {/* Cohort filter */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Client Cohort Filters</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Everything below — KPIs, break-even values, histograms, scenario, and the table —
            reflects only the clients selected here.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* First-appearance (cohort) filter */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Label className="text-xs font-medium">Client first appearance</Label>
              <span className="text-[11px] text-muted-foreground">
                Brand-new cohort: clients whose first-ever activity (or earliest matter
                open date if no activities logged yet) falls in this range.
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={firstFrom}
                  onChange={(e) => {
                    const v = e.target.value
                    setFirstFrom(v)
                    syncCohortToUrl(v, firstTo)
                  }}
                  className="w-40 h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={firstTo}
                  onChange={(e) => {
                    const v = e.target.value
                    setFirstTo(v)
                    syncCohortToUrl(firstFrom, v)
                  }}
                  className="w-40 h-9"
                />
              </div>
              {firstActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFirstFrom("")
                    setFirstTo("")
                    syncCohortToUrl("", "")
                  }}
                >
                  <X className="size-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Matter-opened filter */}
          <div className="pt-3 border-t">
            <div className="flex items-center gap-2 mb-2">
              <Label className="text-xs font-medium">Matter opened date</Label>
              <span className="text-[11px] text-muted-foreground">
                Any matter opened in this range — includes returning clients. Use this for
                &ldquo;who did we onboard a case for in this range?&rdquo;
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={openFrom}
                  onChange={(e) => {
                    const v = e.target.value
                    setOpenFrom(v)
                    syncOpenToUrl(v, openTo)
                  }}
                  className="w-40 h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={openTo}
                  onChange={(e) => {
                    const v = e.target.value
                    setOpenTo(v)
                    syncOpenToUrl(openFrom, v)
                  }}
                  className="w-40 h-9"
                />
              </div>
              {openActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setOpenFrom("")
                    setOpenTo("")
                    syncOpenToUrl("", "")
                  }}
                >
                  <X className="size-3.5 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Engagement type filter */}
          <div className="pt-3 border-t">
            <div className="flex items-center gap-2 mb-2">
              <Label className="text-xs text-muted-foreground">Engagement types</Label>
              <span className="text-[10px] text-muted-foreground">
                Click to include. Selecting none shows all.
              </span>
              {typeFilter.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearTypeFilter}
                  className="h-6 text-xs ml-auto"
                >
                  <X className="size-3 mr-1" />
                  Clear types
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {ENGAGEMENT_TYPES.map((t) => {
                const badge = ENGAGEMENT_BADGE[t]
                const active = typeFilter.has(t)
                const count = typeCounts[t]
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTypeFilter(t)}
                    title={badge.title}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition ${badge.className} ${
                      active
                        ? "ring-2 ring-offset-1 ring-foreground/30"
                        : typeFilter.size > 0
                          ? "opacity-40 hover:opacity-100"
                          : "hover:opacity-90"
                    }`}
                  >
                    {badge.label}
                    <span className="ml-2 text-[11px] opacity-70">
                      {count.toLocaleString()}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Active-filter summary */}
          {(cohortActive || typeFilter.size > 0) && (
            <p className="text-xs text-blue-700 pt-1">
              Showing {summary.clientCount.toLocaleString()} of{" "}
              {rows.length.toLocaleString()} clients
              {firstActive && (
                <>
                  {" "}
                  · first appearance
                  {firstFrom && firstTo
                    ? ` between ${firstFrom} and ${firstTo}`
                    : firstFrom
                      ? ` on/after ${firstFrom}`
                      : ` on/before ${firstTo}`}
                </>
              )}
              {openActive && (
                <>
                  {" "}
                  · matter opened
                  {openFrom && openTo
                    ? ` between ${openFrom} and ${openTo}`
                    : openFrom
                      ? ` on/after ${openFrom}`
                      : ` on/before ${openTo}`}
                </>
              )}
              {typeFilter.size > 0 && (
                <>
                  {" "}
                  · type
                  {typeFilter.size > 1 ? "s" : ""}:{" "}
                  {Array.from(typeFilter)
                    .map((t) => ENGAGEMENT_BADGE[t].label)
                    .join(", ")}
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Scenario Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Retainer Scenario Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-end">
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Monthly Retainer Amount
                </Label>
                <span className="text-sm font-semibold">{formatCurrency(retainer)}</span>
              </div>
              <input
                type="range"
                min={250}
                max={10000}
                step={50}
                value={retainer}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setRetainer(v)
                  setRetainerInput(String(v))
                }}
                onMouseUp={(e) => syncRetainerToUrl(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) =>
                  syncRetainerToUrl(Number((e.target as HTMLInputElement).value))
                }
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>$250</span>
                <span>$2.5k</span>
                <span>$5k</span>
                <span>$7.5k</span>
                <span>$10k</span>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Exact Amount</Label>
              <Input
                type="number"
                min={0}
                step={50}
                className="w-32 h-9"
                value={retainerInput}
                onChange={(e) => setRetainerInput(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Math.min(10000, Number(retainerInput) || 0))
                  setRetainer(v)
                  setRetainerInput(String(v))
                  syncRetainerToUrl(v)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur()
                }}
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Retainer math floors each client&rsquo;s active months to 1 (a flat fee isn&rsquo;t
            pro-rated below a month). Delta = <em>retainer × ceil(months)</em> −{" "}
            <em>total billable</em>.
          </p>
        </CardContent>
      </Card>

      {/* Scenario KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Revenue Under Retainer"
          value={formatCurrency(summary.totalHypothetical)}
          trend={`vs. ${formatCurrency(summary.totalActual)} actual hourly`}
        />
        <KPICard
          label="Firm Revenue Delta"
          value={formatCurrency(summary.firmDelta)}
          trend={`${summary.firmDelta >= 0 ? "gain" : "loss"} at ${formatCurrency(retainer)}/mo`}
          trendDirection={deltaDirection}
        />
        <KPICard
          label="Winner Clients"
          value={summary.winnerCount.toLocaleString()}
          trend={`${((summary.winnerCount / Math.max(1, scenarioRows.length)) * 100).toFixed(0)}% would earn more`}
          trendDirection="up"
        />
        <KPICard
          label="Loser Clients"
          value={summary.loserCount.toLocaleString()}
          trend={`${((summary.loserCount / Math.max(1, scenarioRows.length)) * 100).toFixed(0)}% would earn less`}
          trendDirection="down"
        />
      </div>

      {/* Break-even + revenue framing */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          label="Firm-Level Break-Even"
          value={formatCurrency(summary.firmBreakEven)}
          trend="keeps total firm revenue unchanged"
        />
        <KPICard
          label="Per-Client Median Break-Even"
          value={formatCurrency(summary.medianBreakEven)}
          trend="typical client — half earn more at this rate"
        />
        <KPICard
          label="Per-Client Mean Break-Even"
          value={formatCurrency(summary.meanBreakEven)}
          trend="simple average — pulled up by high-value outliers"
        />
      </div>

      <BreakEvenExplainer
        entity="client"
        firmBreakEven={summary.firmBreakEven}
        medianBreakEven={summary.medianBreakEven}
        meanBreakEven={summary.meanBreakEven}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          label="Revenue Captured"
          value={formatCurrency(summary.revenueCaptured)}
          trend="gained from winners at this retainer"
          trendDirection="up"
        />
        <KPICard
          label="Revenue at Risk"
          value={formatCurrency(summary.revenueAtRisk)}
          trend="given up on losers at this retainer"
          trendDirection="down"
        />
        <KPICard
          label="Top-10 Loser Concentration"
          value={`${(summary.top10LoserShare * 100).toFixed(0)}%`}
          trend={`${formatCurrency(summary.top10LoserImpact)} of at-risk $ from 10 clients`}
        />
      </div>

      {/* Histograms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueDensityHistogram data={densityBuckets} retainer={retainer} />
        <WinnersLosersHistogram
          data={deltaBuckets}
          description={`Per-client delta at ${formatCurrency(retainer)}/mo. Red = lose money under retainer, green = gain.`}
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base">Client List</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {rows.length.toLocaleString()} clients
                {search && filtered.length !== rows.length && (
                  <> · {filtered.length.toLocaleString()} matching &ldquo;{search}&rdquo;</>
                )}
                {scenarioFilter !== "all" && (
                  <> · {scenarioFilter === "winners" ? "winners only" : "losers only"}</>
                )}
                {filtered.length > visible.length && (
                  <> · showing {visible.length.toLocaleString()} of{" "}
                    {filtered.length.toLocaleString()}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={scenarioFilter === "all" ? "default" : "outline"}
                  onClick={() => setScenarioFilter("all")}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant={scenarioFilter === "winners" ? "default" : "outline"}
                  onClick={() => setScenarioFilter("winners")}
                >
                  <TrendingUp className="size-3.5 mr-1" />
                  Winners
                </Button>
                <Button
                  size="sm"
                  variant={scenarioFilter === "losers" ? "default" : "outline"}
                  onClick={() => setScenarioFilter("losers")}
                >
                  <TrendingDown className="size-3.5 mr-1" />
                  Losers
                </Button>
              </div>
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client name…"
                className="w-56 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort("display")}
                >
                  Client{indicator("display")}
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort("engagementType")}
                >
                  Type{indicator("engagementType")}
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer select-none"
                  onClick={() => toggleSort("matterCount")}
                >
                  Matters{indicator("matterCount")}
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer select-none"
                  onClick={() => toggleSort("monthsActive")}
                >
                  Months Active{indicator("monthsActive")}
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer select-none"
                  onClick={() => toggleSort("totalBillable")}
                >
                  Total Billable{indicator("totalBillable")}
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer select-none"
                  onClick={() => toggleSort("avgPerMonth")}
                >
                  Avg $ / Month{indicator("avgPerMonth")}
                </TableHead>
                <TableHead
                  className="text-right cursor-pointer select-none"
                  onClick={() => toggleSort("delta")}
                >
                  Delta{indicator("delta")}
                </TableHead>
                <TableHead>First Activity</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead>First Matter Open</TableHead>
                <TableHead>Last Matter Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <ScenarioClientRow
                  key={r.clientKey}
                  row={r}
                  isExpanded={expandedKey === r.clientKey}
                  isLoading={loadingKey === r.clientKey}
                  activities={activitiesByKey[r.clientKey]}
                  onToggleExpand={() => toggleExpand(r.clientKey, r.matters)}
                />
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                    No clients match this filter
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {filtered.length > limit && (
            <div className="p-3 border-t flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 100)}>
                Show 100 more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const ENGAGEMENT_BADGE: Record<
  EngagementType,
  { label: string; className: string; title: string }
> = {
  ongoing: {
    label: "Ongoing",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    title: "Activity span ≥ 30 days — typical client engagement.",
  },
  "short-burst": {
    label: "Short burst",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    title:
      "2–29 day span (OPs, DV filings, quick hearings). Real work but compressed — inflates $/month density.",
  },
  "single-activity": {
    label: "Single activity",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    title:
      "Exactly one activity on record. Often a consultation, filing fee, or legacy entry.",
  },
  unlogged: {
    label: "Unlogged",
    className: "bg-orange-50 text-orange-700 border-orange-200",
    title:
      "Zero activities across all their matters. Usually brand-new intake with time not yet entered — worth auditing if the matter is >2 weeks old.",
  },
  "flat-fee": {
    label: "Flat fee",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    title:
      "≥70% of revenue came from flat-rate activities (Pre-Nups, uncontested divorces, consultations).",
  },
  "legacy-migration": {
    label: "Legacy import",
    className: "bg-rose-50 text-rose-700 border-rose-200",
    title:
      "Balance-forward activity from the 2016 Xero → Clio migration. Not real work — consider excluding from retainer analysis.",
  },
}

function ScenarioClientRow({
  row: r,
  isExpanded,
  isLoading,
  activities,
  onToggleExpand,
}: {
  row: ScenarioRow
  isExpanded: boolean
  isLoading: boolean
  activities: Activity[] | undefined
  onToggleExpand: () => void
}) {
  const isLoser = r.delta < 0
  const DeltaIcon = r.delta > 0 ? TrendingUp : r.delta < 0 ? TrendingDown : Minus
  const deltaColor =
    r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-rose-600" : "text-muted-foreground"
  const badge = ENGAGEMENT_BADGE[r.engagementType]

  const mattersById = useMemo(() => {
    const map = new Map<string, ClientMatter>()
    for (const m of r.matters) map.set(m.unique_id, m)
    return map
  }, [r.matters])

  return (
    <>
      <TableRow
        className={`cursor-pointer ${isLoser ? "bg-rose-50/40" : ""}`}
        onClick={onToggleExpand}
      >
        <TableCell className="pl-3">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-sm font-medium">
          <div className="max-w-[240px] truncate" title={r.display}>
            {r.display}
          </div>
          {r.isJoint && (
            <Badge variant="outline" className="mt-1 text-[10px]">
              Joint
            </Badge>
          )}
        </TableCell>
        <TableCell>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
            title={badge.title}
          >
            {badge.label}
          </span>
        </TableCell>
        <TableCell className="text-right text-sm">{r.matterCount}</TableCell>
        <TableCell className="text-right text-sm">
          {r.monthsActive > 0 ? r.monthsActive.toFixed(1) : "—"}
        </TableCell>
        <TableCell className="text-right text-sm font-semibold">
          {formatCurrency(r.totalBillable)}
        </TableCell>
        <TableCell className="text-right text-sm">
          {r.avgPerMonth > 0 ? formatCurrency(r.avgPerMonth) : "—"}
        </TableCell>
        <TableCell className={`text-right text-sm font-semibold ${deltaColor}`}>
          <span className="inline-flex items-center gap-1 justify-end">
            <DeltaIcon className="size-3.5" />
            {formatCurrency(r.delta)}
          </span>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {r.firstActivityDate ?? "—"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {r.lastActivityDate ?? "—"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {r.firstMatterOpenDate ?? "—"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {r.lastMatterOpenDate ?? "—"}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={12} className="bg-slate-50 p-0">
            <div className="px-6 py-4 space-y-4">
              {/* Matter summary */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Matters ({r.matters.length})
                </div>
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col />
                    <col className="w-[140px]" />
                    <col className="w-[100px]" />
                    <col className="w-[90px]" />
                    <col className="w-[110px]" />
                    <col className="w-[110px]" />
                    <col className="w-[120px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left py-1.5 font-medium">Matter</th>
                      <th className="text-left py-1.5 font-medium">Case Type</th>
                      <th className="text-right py-1.5 font-medium">Billable</th>
                      <th className="text-right py-1.5 font-medium">Activities</th>
                      <th className="text-left py-1.5 font-medium">First act.</th>
                      <th className="text-left py-1.5 font-medium">Last act.</th>
                      <th className="text-left py-1.5 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.matters.map((m) => (
                      <tr key={m.unique_id} className="border-b border-slate-100">
                        <td className="py-1.5 truncate" title={m.display_number}>
                          {m.display_number}
                        </td>
                        <td className="py-1.5 truncate">
                          {m.mapped_category ?? m.case_type ?? "—"}
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          {formatCurrency(m.total_billable)}
                        </td>
                        <td className="py-1.5 text-right">
                          {m.activity_count ?? "—"}
                        </td>
                        <td className="py-1.5">{m.firstActivityDate ?? "—"}</td>
                        <td className="py-1.5">{m.lastActivityDate ?? "—"}</td>
                        <td className="py-1.5">
                          {m.hasLegacyMigration && (
                            <Badge
                              variant="outline"
                              className="mr-1 text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                            >
                              Xero
                            </Badge>
                          )}
                          {m.hasFlatRateActivity && (
                            <Badge
                              variant="outline"
                              className="mr-1 text-[10px] bg-blue-50 text-blue-700 border-blue-200"
                            >
                              Flat
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Activities timeline */}
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Activities {activities ? `(${activities.length})` : ""}
                </div>
                {isLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading activities...
                  </div>
                ) : activities && activities.length > 0 ? (
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-xs table-fixed">
                      <colgroup>
                        <col className="w-[90px]" />
                        <col className="w-[180px]" />
                        <col className="w-[70px]" />
                        <col className="w-[120px]" />
                        <col />
                        <col className="w-[60px]" />
                        <col className="w-[70px]" />
                        <col className="w-[90px]" />
                      </colgroup>
                      <thead>
                        <tr className="text-muted-foreground border-b sticky top-0 bg-slate-50">
                          <th className="text-left py-1.5 font-medium">Date</th>
                          <th className="text-left py-1.5 font-medium">Matter</th>
                          <th className="text-left py-1.5 font-medium">Type</th>
                          <th className="text-left py-1.5 font-medium">User</th>
                          <th className="text-left py-1.5 font-medium">Description</th>
                          <th className="text-right py-1.5 font-medium">Hours</th>
                          <th className="text-right py-1.5 font-medium">Rate</th>
                          <th className="text-right py-1.5 font-medium">Billable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activities.map((a, i) => {
                          const matter = a.matter_unique_id
                            ? mattersById.get(String(a.matter_unique_id))
                            : undefined
                          return (
                            <tr key={i} className="border-b border-slate-100">
                              <td className="py-1.5 text-muted-foreground truncate">
                                {a.activity_date ?? "—"}
                              </td>
                              <td
                                className="py-1.5 truncate"
                                title={matter?.display_number ?? ""}
                              >
                                {matter?.display_number ?? "—"}
                              </td>
                              <td className="py-1.5">
                                <Badge variant="outline" className="text-[10px]">
                                  {a.type === "TimeEntry" ? "Time" : "Expense"}
                                </Badge>
                              </td>
                              <td className="py-1.5 truncate" title={a.user_name ?? ""}>
                                {a.user_name ?? "—"}
                              </td>
                              <td className="py-1.5 truncate" title={a.description ?? ""}>
                                {a.description ?? "—"}
                              </td>
                              <td className="py-1.5 text-right">{a.hours || "—"}</td>
                              <td className="py-1.5 text-right">
                                {a.rate ? `$${a.rate}` : "—"}
                              </td>
                              <td className="py-1.5 text-right font-medium">
                                {a.billable_amount
                                  ? formatCurrency(a.billable_amount)
                                  : "—"}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-4">No activities found</p>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
