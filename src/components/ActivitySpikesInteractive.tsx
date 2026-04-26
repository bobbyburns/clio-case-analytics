"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ArrowDown,
  ArrowUp,
  Loader2,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { KPICard } from "@/components/charts/KPICard"
import { FirmWeeklyBillableChart } from "@/components/charts/ActivitySpikesCharts"
import { SpikeExplainer } from "@/components/SpikeExplainer"
import { SpikeEventAnalysis } from "@/components/SpikeEventAnalysis"
import { SpikeMetaDashboard } from "@/components/SpikeMetaDashboard"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { tokenizeTriggers, type TriggerKeyword } from "@/lib/spikes"
import type { SpikeRow, StoredSpikeAnalysis } from "@/app/(dashboard)/activity-spikes/page"
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

type SortKey =
  | "display_number"
  | "client_display"
  | "week_start"
  | "billable"
  | "baselineMedian"
  | "ratio"
  | "hours"
  | "activity_count"
  | "rule"
  | "suggestedSurcharge"

interface StageBucket {
  stage: string
  spikeCount: number
  spikeBillable: number
  pctOfSpikes: number
}

interface CategoryTally {
  category: string
  count: number
  total: number
}

interface TypeSplit {
  timeCount: number
  expenseCount: number
  timeTotal: number
  expenseTotal: number
}

interface Props {
  spikes: SpikeRow[]
  firmWeekly: Array<{ week: string; billable: number; rolling4: number }>
  spikeWeekSet: string[]
  initialRatio: number
  initialFloor: number
  stageDistribution: StageBucket[]
  initialTriggerKeywords: TriggerKeyword[]
  initialExpenseCategories: CategoryTally[]
  initialTypeSplit: TypeSplit
  leaderboardSampleSize: number
  kpis: KpiBundle
}

export function ActivitySpikesInteractive({
  spikes,
  firmWeekly,
  spikeWeekSet,
  initialRatio,
  initialFloor,
  stageDistribution,
  initialTriggerKeywords,
  initialExpenseCategories,
  initialTypeSplit,
  leaderboardSampleSize,
  kpis,
}: Props) {
  const [spikeListOpen, setSpikeListOpen] = useState(false)

  // In-session AI analyses: anything analyzed during this page-load is held
  // here, layered over the SSR-loaded storedAnalysis on each row. Both the
  // bulk and per-row analysis paths write into this map so badges/rows update
  // immediately without a full page reload.
  const [sessionAnalyses, setSessionAnalyses] = useState<Map<string, StoredSpikeAnalysis>>(
    new Map(),
  )
  const upsertSessionAnalysis = useCallback(
    (key: string, analysis: StoredSpikeAnalysis) => {
      setSessionAnalyses((prev) => {
        const next = new Map(prev)
        next.set(key, analysis)
        return next
      })
    },
    [],
  )
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

  // Column filters
  const [matterFilter, setMatterFilter] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("")
  const [minBillable, setMinBillable] = useState<string>("")
  const [minRatio, setMinRatio] = useState<string>("")
  const [ruleFilter, setRuleFilter] = useState<"all" | "ratio" | "absolute">("all")
  const [stageFilter, setStageFilter] = useState<string>("")

  // Keyword search (server-side)
  const [keyword, setKeyword] = useState("")
  const [keywordMatches, setKeywordMatches] = useState<Set<string> | null>(null)
  const [keywordLoading, setKeywordLoading] = useState(false)
  const [keywordError, setKeywordError] = useState<string | null>(null)
  const keywordReqRef = useRef(0)

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("billable")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

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

  // Mapped categories present in spike list, for the filter dropdown.
  const availableCategories = useMemo(() => {
    const set = new Set<string>()
    for (const s of spikes) if (s.mapped_category) set.add(s.mapped_category)
    return Array.from(set).sort()
  }, [spikes])

  // Debounced keyword fetch.
  useEffect(() => {
    const trimmed = keyword.trim()
    if (trimmed.length < 3) {
      setKeywordMatches(null)
      setKeywordError(null)
      return
    }
    const reqId = ++keywordReqRef.current
    setKeywordLoading(true)
    setKeywordError(null)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/spike-keyword?q=${encodeURIComponent(trimmed)}&floor=${encodeURIComponent(floor)}`,
        )
        const data = await res.json()
        if (reqId !== keywordReqRef.current) return // stale
        if (!res.ok) {
          setKeywordError(data.error ?? `HTTP ${res.status}`)
          setKeywordMatches(new Set())
        } else {
          setKeywordMatches(new Set(data.matches ?? []))
        }
      } catch (e) {
        if (reqId !== keywordReqRef.current) return
        setKeywordError(e instanceof Error ? e.message : String(e))
        setKeywordMatches(new Set())
      } finally {
        if (reqId === keywordReqRef.current) setKeywordLoading(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [keyword, floor])

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      } else {
        setSortKey(key)
        setSortDir(key === "week_start" || key === "ratio" || key === "billable" ? "desc" : "asc")
      }
    },
    [sortKey],
  )

  const filteredSorted = useMemo(() => {
    const minB = Number(minBillable) || 0
    const minR = Number(minRatio) || 0
    const matterQ = matterFilter.trim().toLowerCase()
    const clientQ = clientFilter.trim().toLowerCase()

    let list = spikes.filter((s) => {
      if (matterQ && !s.display_number.toLowerCase().includes(matterQ)) return false
      if (clientQ && !s.client_display.toLowerCase().includes(clientQ)) return false
      if (categoryFilter && s.mapped_category !== categoryFilter) return false
      if (s.billable < minB) return false
      if (Number.isFinite(s.ratio) && s.ratio < minR) return false
      if (ruleFilter !== "all" && s.rule !== ruleFilter) return false
      if (stageFilter && s.lifecycleStage !== stageFilter) return false
      if (keywordMatches !== null) {
        const k = `${s.matter_unique_id}__${s.week_start}`
        if (!keywordMatches.has(k)) return false
      }
      return true
    })

    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      switch (sortKey) {
        case "display_number":
          return a.display_number.localeCompare(b.display_number) * dir
        case "client_display":
          return a.client_display.localeCompare(b.client_display) * dir
        case "week_start":
          return a.week_start.localeCompare(b.week_start) * dir
        case "billable":
          return (a.billable - b.billable) * dir
        case "baselineMedian":
          return (a.baselineMedian - b.baselineMedian) * dir
        case "ratio": {
          const ar = Number.isFinite(a.ratio) ? a.ratio : 0
          const br = Number.isFinite(b.ratio) ? b.ratio : 0
          return (ar - br) * dir
        }
        case "hours":
          return (a.hours - b.hours) * dir
        case "activity_count":
          return (a.activity_count - b.activity_count) * dir
        case "rule":
          return a.rule.localeCompare(b.rule) * dir
        case "suggestedSurcharge": {
          const as = a.billable - a.baselineMedian
          const bs = b.billable - b.baselineMedian
          return (as - bs) * dir
        }
      }
      return 0
    })
    return list
  }, [
    spikes,
    matterFilter,
    clientFilter,
    categoryFilter,
    minBillable,
    minRatio,
    ruleFilter,
    stageFilter,
    keywordMatches,
    sortKey,
    sortDir,
  ])

  const visibleSpikes = filteredSorted.slice(0, 200).map((s) => {
    const key = `${s.matter_unique_id}__${s.week_start}`
    const live = sessionAnalyses.get(key)
    if (!live) return s
    return { ...s, storedAnalysis: live }
  })

  const filtersActive =
    matterFilter !== "" ||
    clientFilter !== "" ||
    categoryFilter !== "" ||
    minBillable !== "" ||
    minRatio !== "" ||
    ruleFilter !== "all" ||
    stageFilter !== "" ||
    keyword.trim() !== ""

  const clearAllFilters = () => {
    setMatterFilter("")
    setClientFilter("")
    setCategoryFilter("")
    setMinBillable("")
    setMinRatio("")
    setRuleFilter("all")
    setStageFilter("")
    setKeyword("")
  }

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

  // Combine the server-precomputed leaderboard (top 100 spikes) with any
  // additional rows the user has expanded since page load. Expanded rows
  // augment the keyword sample but the server precompute is the floor.
  const expandedActivities = useMemo(() => {
    const all: SpikeActivityRow[] = []
    for (const arr of Object.values(drilldownByKey)) all.push(...arr)
    return all
  }, [drilldownByKey])

  const triggerKeywords: TriggerKeyword[] = useMemo(() => {
    if (expandedActivities.length === 0) return initialTriggerKeywords
    const merged = tokenizeTriggers(expandedActivities)
    // Merge by stemmed keyword, summing counts/billable.
    const byKw = new Map<string, TriggerKeyword>()
    for (const k of initialTriggerKeywords) byKw.set(k.keyword, { ...k })
    for (const k of merged) {
      const cur = byKw.get(k.keyword)
      if (cur) {
        cur.count += k.count
        cur.totalBillable += k.totalBillable
      } else {
        byKw.set(k.keyword, { ...k })
      }
    }
    return Array.from(byKw.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 25)
  }, [expandedActivities, initialTriggerKeywords])

  const expenseCategoryTally = useMemo(() => {
    if (expandedActivities.length === 0) return initialExpenseCategories
    const tally = new Map<string, { count: number; total: number }>()
    for (const c of initialExpenseCategories) {
      tally.set(c.category, { count: c.count, total: c.total })
    }
    for (const a of expandedActivities) {
      const key = a.expense_category ?? "—"
      const cur = tally.get(key)
      if (cur) {
        cur.count++
        cur.total += a.billable_amount
      } else {
        tally.set(key, { count: 1, total: a.billable_amount })
      }
    }
    return Array.from(tally.entries())
      .map(([category, v]) => ({ category, count: v.count, total: v.total }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [expandedActivities, initialExpenseCategories])

  const typeTally = useMemo(() => {
    if (expandedActivities.length === 0) return initialTypeSplit
    let { timeCount, expenseCount, timeTotal, expenseTotal } = initialTypeSplit
    for (const a of expandedActivities) {
      if (a.type === "TimeEntry") {
        timeCount++
        timeTotal += a.billable_amount
      } else {
        expenseCount++
        expenseTotal += a.billable_amount
      }
    }
    return { timeCount, expenseCount, timeTotal, expenseTotal }
  }, [expandedActivities, initialTypeSplit])

  const drilldownRowsLoaded = Object.keys(drilldownByKey).length
  const leaderboardSampleTotal = leaderboardSampleSize + drilldownRowsLoaded

  return (
    <div className="space-y-6">
      <SpikeExplainer />

      {/* Detection knobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Spike Detection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground" title="A week is a spike if its billable is at least this many times the matter's median weekly billable.">
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
                <Label className="text-xs text-muted-foreground" title="A week's billable must also be at least this dollar amount. Filters out tiny matters where a $20 baseline ratios up to noise.">
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

      <FirmWeeklyBillableChart data={firmWeekly} spikeWeeks={spikeWeekLookup} />

      {/* Spike timing — when in a matter's lifecycle do spikes happen? */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Spike timing — when do spikes happen?</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Each spike is bucketed by where it falls in its matter&rsquo;s lifecycle (first
            activity → last activity). &ldquo;First month&rdquo; means within ~30 days of the
            matter&rsquo;s first activity; &ldquo;Last month&rdquo; means within ~30 days of
            the most recent. Click a row to filter the spike list to that stage.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stageDistribution.map((b) => {
              const active = stageFilter === b.stage
              const widthPct = Math.max(0, Math.min(100, b.pctOfSpikes))
              return (
                <button
                  key={b.stage}
                  type="button"
                  onClick={() => setStageFilter(active ? "" : b.stage)}
                  className={`w-full text-left rounded-md border px-3 py-2 transition ${
                    active
                      ? "border-blue-400 bg-blue-50"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{b.stage}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatNumber(b.spikeCount)} spike{b.spikeCount === 1 ? "" : "s"} ·{" "}
                      {formatCurrency(b.spikeBillable)} ·{" "}
                      <span className="font-semibold text-foreground">
                        {b.pctOfSpikes.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        active ? "bg-blue-600" : "bg-blue-400/70"
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Patterns to look for: a heavy <strong>First-month</strong> share suggests
            front-loaded discovery / intake costs (consider a higher initial downpayment).
            A heavy <strong>Last-month</strong> share suggests trial / settlement crunches
            (consider an event surcharge for trial weeks). A flat distribution suggests
            steady, unpredictable bursts throughout the case.
          </p>
        </CardContent>
      </Card>

      {/* AI-powered event classification across the top 50 spikes */}
      <SpikeEventAnalysis
        topSpikes={spikes.slice(0, 50)}
        onAnalysisComplete={upsertSessionAnalysis}
      />

      {/* Second-pass meta-analysis: surcharge strategy across all classified spikes */}
      <SpikeMetaDashboard spikes={spikes} sessionAnalyses={sessionAnalyses} />

      {/* Spike list with filters + sort + keyword search — collapsed by default */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <button
              type="button"
              onClick={() => setSpikeListOpen((v) => !v)}
              className="flex items-start gap-2 text-left flex-1"
            >
              {spikeListOpen ? (
                <ChevronDown className="size-4 mt-0.5" />
              ) : (
                <ChevronRight className="size-4 mt-0.5" />
              )}
              <div>
                <CardTitle className="text-base">
                  Spike list ({formatNumber(filteredSorted.length)}
                  {filteredSorted.length !== spikes.length && (
                    <span className="text-muted-foreground font-normal">
                      {" "}of {formatNumber(spikes.length)}
                    </span>
                  )}
                  )
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {spikeListOpen
                    ? "Click a row to load the activities for that week. Click column headers to sort."
                    : "Click to expand the matter-level spike list. Useful for drilling into specific cases — but the patterns above (timing, leaderboard) are usually more actionable."}
                </p>
              </div>
            </button>
            {spikeListOpen && filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-8 text-xs"
              >
                <X className="size-3 mr-1" /> Clear all filters
              </Button>
            )}
          </div>
        </CardHeader>
        {spikeListOpen && (
        <CardContent className="space-y-3">
          {/* Keyword search */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search activity descriptions: hearing, deposition, mediation, trial…"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9 pr-9 h-9"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            {keywordLoading && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            {keywordError && (
              <span className="text-xs text-rose-600">Search error: {keywordError}</span>
            )}
            {keywordMatches !== null && !keywordLoading && (
              <span className="text-xs text-muted-foreground">
                {keywordMatches.size === 0
                  ? "No spike weeks contain that keyword"
                  : `${keywordMatches.size.toLocaleString()} matter-week(s) contain "${keyword.trim()}"`}
              </span>
            )}
          </div>

          {/* Column filter row */}
          <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
            <Input
              placeholder="Matter #"
              value={matterFilter}
              onChange={(e) => setMatterFilter(e.target.value)}
              className="h-9 text-xs"
            />
            <Input
              placeholder="Client name"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="h-9 text-xs"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">All categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Input
              type="number"
              placeholder="Min billable $"
              value={minBillable}
              onChange={(e) => setMinBillable(e.target.value)}
              className="h-9 text-xs"
            />
            <Input
              type="number"
              step="0.1"
              placeholder="Min ratio ×"
              value={minRatio}
              onChange={(e) => setMinRatio(e.target.value)}
              className="h-9 text-xs"
            />
            <select
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value as typeof ruleFilter)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">All rules</option>
              <option value="ratio">ratio (≥8 weeks of data)</option>
              <option value="absolute">absolute (sparse baseline)</option>
            </select>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">All stages</option>
              {stageDistribution.map((b) => (
                <option key={b.stage} value={b.stage}>
                  {b.stage}
                </option>
              ))}
            </select>
          </div>

          <Table className="table-fixed text-xs">
            <colgroup>
              <col className="w-7" />
              <col className="w-[180px]" />
              <col />
              <col className="w-[88px]" />
              <col className="w-[78px]" />
              <col className="w-[80px]" />
              <col className="w-[56px]" />
              <col className="w-[60px]" />
              <col className="w-[60px]" />
              <col className="w-[88px]" />
              <col className="w-[64px]" />
              <col className="w-[88px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="px-1" />
                <SortHeader label="Matter" k="display_number" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("display_number")} />
                <SortHeader label="Client" k="client_display" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("client_display")} />
                <SortHeader label="Week of" k="week_start" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("week_start")} />
                <SortHeader label="Billable" k="billable" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("billable")} align="right" />
                <SortHeader
                  label="Baseline"
                  k="baselineMedian"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={() => toggleSort("baselineMedian")}
                  align="right"
                  title="Baseline median — the middle of this matter's weekly billable totals (the matter's normal week)."
                />
                <SortHeader
                  label="Ratio"
                  k="ratio"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={() => toggleSort("ratio")}
                  align="right"
                  title="Week billable ÷ baseline median. 5× = this week earned 5× the matter's normal week."
                />
                <SortHeader label="Hours" k="hours" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("hours")} align="right" />
                <SortHeader label="Acts" k="activity_count" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("activity_count")} align="right" title="Activity count" />
                <SortHeader
                  label="Surcharge"
                  k="suggestedSurcharge"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={() => toggleSort("suggestedSurcharge")}
                  align="right"
                  title="Suggested surcharge = spike billable minus baseline. Roughly the extra you'd need to charge to break even on this week."
                />
                <SortHeader label="Rule" k="rule" sortKey={sortKey} sortDir={sortDir} onClick={() => toggleSort("rule")} />
                <TableHead title="When in the matter's lifecycle this spike happened">Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSpikes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-sm text-muted-foreground">
                    No spikes match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleSpikes.map((s) => {
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
                      onAnalysisComplete={upsertSessionAnalysis}
                    />
                  )
                })
              )}
            </TableBody>
          </Table>
          {filteredSorted.length > 200 && (
            <p className="text-xs text-muted-foreground border-t pt-3">
              Showing top 200 of {formatNumber(filteredSorted.length)} matching spikes. Tighten filters to narrow further.
            </p>
          )}
        </CardContent>
        )}
      </Card>

      {/* Trigger leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Trigger Leaderboard</CardTitle>
          <p className="text-xs text-muted-foreground">
            Precomputed across the top {leaderboardSampleSize.toLocaleString()} spikes by
            billable. Expanding more rows below adds to the sample
            {drilldownRowsLoaded > 0 ? (
              <> (currently {leaderboardSampleTotal.toLocaleString()} spike-weeks sampled)</>
            ) : null}
            . Click a keyword to filter the spike list to weeks containing it.
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
                  No keywords found in the sampled spike-week activities.
                </p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {triggerKeywords.map((k) => (
                    <li key={k.keyword} className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setKeyword(k.keyword)}
                        className="font-mono hover:text-blue-600 hover:underline text-left"
                        title={`Search spikes containing "${k.keyword}"`}
                      >
                        {k.keyword}
                      </button>
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
                  No expense categories in the sampled spike-week activities.
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
                  No activities sampled.
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

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  align = "left",
  title,
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: "asc" | "desc"
  onClick: () => void
  align?: "left" | "right"
  title?: string
}) {
  const active = sortKey === k
  const Icon = !active ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`inline-flex items-center gap-1 hover:text-foreground transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-foreground font-semibold" : ""}`}
      >
        <span>{label}</span>
        <Icon className="size-3 opacity-60" />
      </button>
    </TableHead>
  )
}

interface SingleSpikeAnalysis {
  primary_event: string
  secondary_events: string[]
  narrative: string
  evidence_quotes: string[]
}

function SpikeRowExpander({
  rowKey,
  spike,
  isExpanded,
  isLoading,
  drilldown,
  drillError,
  onToggle,
  onAnalysisComplete,
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
  onAnalysisComplete: (key: string, analysis: StoredSpikeAnalysis) => void
}) {
  const surcharge = Math.max(0, spike.billable - spike.baselineMedian)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<SingleSpikeAnalysis | null>(
    spike.storedAnalysis
      ? {
          primary_event: spike.storedAnalysis.primary_event,
          secondary_events: spike.storedAnalysis.secondary_events,
          narrative: spike.storedAnalysis.narrative,
          evidence_quotes: spike.storedAnalysis.evidence_quotes,
        }
      : null,
  )
  const isFromCache = !aiLoading && aiResult !== null && spike.storedAnalysis !== null && spike.storedAnalysis.primary_event === aiResult.primary_event && !aiError

  const runAnalysis = async () => {
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch("/api/analyze-spikes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spikes: [
            {
              matter_unique_id: spike.matter_unique_id,
              week_start: spike.week_start,
              display_number: spike.display_number,
              client_display: spike.client_display,
              billable: spike.billable,
              ratio: Number.isFinite(spike.ratio) ? spike.ratio : 0,
              hours: spike.hours,
            },
          ],
        }),
      })
      const text = await res.text()
      let data: { spikes?: SingleSpikeAnalysis[]; error?: string }
      try {
        data = JSON.parse(text)
      } catch {
        // Server returned non-JSON (e.g. function timeout / Vercel error page).
        setAiError(
          `Server returned non-JSON (HTTP ${res.status}). First 200 chars: ${text.slice(0, 200)}`,
        )
        return
      }
      if (!res.ok) {
        setAiError(data.error ?? `HTTP ${res.status}`)
        return
      }
      const first = data.spikes?.[0]
      if (!first) {
        setAiError("AI returned no analysis for this spike")
        return
      }
      setAiResult(first)
      // Lift this analysis into the parent so the spike list badge and any
      // other expansion of the same row reflect it without a page reload.
      onAnalysisComplete(`${spike.matter_unique_id}__${spike.week_start}`, {
        primary_event: first.primary_event,
        secondary_events: first.secondary_events ?? [],
        narrative: first.narrative ?? "",
        evidence_quotes: first.evidence_quotes ?? [],
        analyzed_at: new Date().toISOString(),
      })
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e))
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/40"
        onClick={onToggle}
      >
        <TableCell className="px-1">
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="font-mono text-[11px] truncate" title={spike.display_number}>
          {spike.display_number}
        </TableCell>
        <TableCell className="truncate" title={spike.client_display}>
          {spike.client_display}
        </TableCell>
        <TableCell className="font-mono text-[11px]">{spike.week_start}</TableCell>
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
        <TableCell className="text-right tabular-nums text-emerald-700">
          {spike.baselineMedian > 0 ? formatCurrency(surcharge) : "—"}
        </TableCell>
        <TableCell>
          <span
            className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              spike.rule === "ratio"
                ? "bg-blue-50 text-blue-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {spike.rule === "ratio" ? "ratio" : "abs"}
          </span>
        </TableCell>
        <TableCell className="text-[10px] text-muted-foreground truncate" title={spike.storedAnalysis ? `${spike.lifecycleStage} · AI: ${spike.storedAnalysis.primary_event}` : spike.lifecycleStage}>
          <div className="truncate">{spike.lifecycleStage}</div>
          {spike.storedAnalysis && (
            <div className="text-[9px] font-medium text-violet-700 truncate">
              ✦ {spike.storedAnalysis.primary_event}
            </div>
          )}
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow>
          <TableCell colSpan={12} className="bg-muted/30 p-4 space-y-3">
            {/* AI per-spike analysis */}
            <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs">
                  <span className="font-semibold text-violet-900">
                    <Sparkles className="size-3 inline mr-1 -mt-0.5" />
                    AI event classification for this spike
                  </span>
                  <span className="text-muted-foreground ml-2">
                    Sends just this matter-week to Claude to identify the underlying event.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={runAnalysis}
                  disabled={aiLoading}
                  className="h-7 bg-violet-600 hover:bg-violet-700 text-xs"
                >
                  {aiLoading ? (
                    <>
                      <Loader2 className="size-3 mr-1.5 animate-spin" /> Analyzing…
                    </>
                  ) : aiResult ? (
                    "Re-analyze"
                  ) : (
                    "Analyze this spike"
                  )}
                </Button>
              </div>
              {aiError && (
                <p className="text-xs text-rose-700 mt-2 break-all">{aiError}</p>
              )}
              {aiResult && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex rounded-full border border-violet-300 bg-violet-100 text-violet-900 px-2.5 py-0.5 text-xs font-medium">
                      {aiResult.primary_event}
                    </span>
                    {aiResult.secondary_events.map((ev) => (
                      <span
                        key={ev}
                        className="inline-flex rounded-full border border-slate-300 bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px]"
                      >
                        + {ev}
                      </span>
                    ))}
                    {isFromCache && spike.storedAnalysis && (
                      <span className="text-[10px] text-muted-foreground">
                        Saved · {new Date(spike.storedAnalysis.analyzed_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground">{aiResult.narrative}</p>
                  {aiResult.evidence_quotes.length > 0 && (
                    <ul className="space-y-0.5 text-[11px] italic text-muted-foreground">
                      {aiResult.evidence_quotes.map((q, i) => (
                        <li key={i}>&ldquo;{q}&rdquo;</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading activities…
              </div>
            ) : drillError ? (
              <p className="text-sm text-rose-700">Error: {drillError}</p>
            ) : drilldown && drilldown.length > 0 ? (
              <div className="w-full">
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col className="w-[88px]" />
                    <col className="w-[60px]" />
                    <col className="w-[120px]" />
                    <col />
                    <col className="w-[60px]" />
                    <col className="w-[72px]" />
                    <col className="w-[88px]" />
                  </colgroup>
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
                      <tr key={`${rowKey}-${i}`} className="border-t border-border/40 align-top">
                        <td className="pr-3 py-1 font-mono">{a.activity_date ?? "—"}</td>
                        <td className="pr-3 py-1">
                          {a.type === "TimeEntry" ? "Time" : "Expense"}
                        </td>
                        <td className="pr-3 py-1 truncate" title={a.user_name ?? ""}>
                          {a.user_name ?? "—"}
                        </td>
                        <td
                          className="pr-3 py-1 break-words whitespace-normal"
                          title={a.description ?? ""}
                        >
                          {a.description ?? "—"}
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
