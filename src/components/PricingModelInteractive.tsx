"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react"
import { KPICard } from "@/components/charts/KPICard"
import {
  WinnersLosersHistogram,
  RevenueDensityHistogram,
  BreakEvenByCaseTypeChart,
  ClientMonthlyRevenueArea,
  PredictabilityLineChart,
} from "@/components/charts/PricingModelCharts"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { parseClientsField } from "@/lib/utils/clients"
import {
  breakEvenByCategory,
  computeBreakEvenPerMatter,
  deltaHistogram,
  densityHistogram,
  revenuePredictability,
  runScenario,
  type ScenarioMatter,
} from "@/lib/utils/pricing"
import type { Activity } from "@/lib/types"

interface Props {
  scenarioMatters: ScenarioMatter[]
  monthlyHourlyEntries: Array<[string, number]>
  monthlyTopClientsData: Array<Record<string, string | number>>
  topClientKeys: string[]
  clientLeaderboard: Array<{
    clientKey: string
    display: string
    isJoint: boolean
    totalRevenue: number
    monthsActive: number
    avgMonthlyValue: number
    matterCount: number
  }>
  flatFeeCount: number
  totalInScopeBeforeOutliers: number
  jointMatterPct: number
  initialRetainer: number
  initialExcludeOutliers: boolean
}

export function PricingModelInteractive({
  scenarioMatters,
  monthlyHourlyEntries,
  monthlyTopClientsData,
  topClientKeys,
  clientLeaderboard,
  flatFeeCount,
  totalInScopeBeforeOutliers,
  jointMatterPct,
  initialRetainer,
  initialExcludeOutliers,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [retainer, setRetainer] = useState(initialRetainer)
  const [excludeOutliers, setExcludeOutliers] = useState(initialExcludeOutliers)
  const [retainerInput, setRetainerInput] = useState(String(initialRetainer))

  const syncRetainerToUrl = useCallback(
    (value: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value !== 1500) params.set("retainer", String(value))
      else params.delete("retainer")
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const toggleOutliers = useCallback(() => {
    const next = !excludeOutliers
    setExcludeOutliers(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set("excludeOutliers", "1")
    else params.delete("excludeOutliers")
    router.replace(`${pathname}?${params.toString()}`)
  }, [excludeOutliers, router, pathname, searchParams])

  // Apply outlier exclusion client-side so the toggle feels instant.
  const mattersForScenario = useMemo(() => {
    if (!excludeOutliers) return scenarioMatters
    const sorted = [...scenarioMatters].sort((a, b) => b.totalBillable - a.totalBillable)
    const cutoff = Math.max(1, Math.floor(sorted.length * 0.05))
    const excludeIds = new Set(sorted.slice(0, cutoff).map((m) => m.unique_id))
    return scenarioMatters.filter((m) => !excludeIds.has(m.unique_id))
  }, [scenarioMatters, excludeOutliers])

  const results = useMemo(() => runScenario(mattersForScenario, retainer), [
    mattersForScenario,
    retainer,
  ])

  const summary = useMemo(() => {
    const totalActual = mattersForScenario.reduce((s, m) => s + m.totalBillable, 0)
    const totalHypothetical = results.reduce((s, r) => s + r.hypotheticalRevenue, 0)
    const winners = results.filter((r) => r.isWinner).length
    const losers = results.filter((r) => r.delta < 0).length
    return {
      totalActual,
      totalHypothetical,
      totalDelta: totalHypothetical - totalActual,
      winners,
      losers,
    }
  }, [mattersForScenario, results])

  const breakEven = useMemo(() => computeBreakEvenPerMatter(mattersForScenario), [
    mattersForScenario,
  ])

  const densityData = useMemo(() => densityHistogram(breakEven.densities), [
    breakEven.densities,
  ])

  const deltaData = useMemo(
    () => deltaHistogram(results.map((r) => r.delta)),
    [results],
  )

  const categoryData = useMemo(() => breakEvenByCategory(mattersForScenario), [
    mattersForScenario,
  ])

  const monthlyHourly = useMemo(
    () => new Map(monthlyHourlyEntries),
    [monthlyHourlyEntries],
  )

  const predictability = useMemo(
    () => revenuePredictability(monthlyHourly, mattersForScenario, retainer),
    [monthlyHourly, mattersForScenario, retainer],
  )

  const predictabilityData = useMemo(() => {
    const months = Array.from(monthlyHourly.keys()).sort()
    const scenarioByMonth = new Map<string, number>()
    for (const m of mattersForScenario) {
      if (!m.firstActivityDate) continue
      const first = m.firstActivityDate.slice(0, 7)
      const last = (m.lastActivityDate ?? m.firstActivityDate).slice(0, 7)
      for (const ym of months) {
        if (ym >= first && ym <= last) {
          scenarioByMonth.set(ym, (scenarioByMonth.get(ym) ?? 0) + retainer)
        }
      }
    }
    return months.map((ym) => ({
      month: ym,
      hourly: Math.round(monthlyHourly.get(ym) ?? 0),
      scenario: Math.round(scenarioByMonth.get(ym) ?? 0),
    }))
  }, [monthlyHourly, mattersForScenario, retainer])

  const deltaDirection: "up" | "down" | "neutral" =
    summary.totalDelta > 0 ? "up" : summary.totalDelta < 0 ? "down" : "neutral"

  return (
    <div className="space-y-6">
      <ScenarioControls
        retainer={retainer}
        retainerInput={retainerInput}
        setRetainer={setRetainer}
        setRetainerInput={setRetainerInput}
        onCommit={syncRetainerToUrl}
        excludeOutliers={excludeOutliers}
        onToggleOutliers={toggleOutliers}
        flatFeeCount={flatFeeCount}
        totalInScopeBeforeOutliers={totalInScopeBeforeOutliers}
        currentInScope={mattersForScenario.length}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Revenue Under Retainer"
          value={formatCurrency(summary.totalHypothetical)}
          trend={`vs. ${formatCurrency(summary.totalActual)} actual hourly`}
          trendDirection="neutral"
        />
        <KPICard
          label="Firm Revenue Delta"
          value={formatCurrency(summary.totalDelta)}
          trend={`${summary.totalDelta >= 0 ? "gain" : "loss"} at $${retainer}/mo`}
          trendDirection={deltaDirection}
        />
        <KPICard
          label="Winner Matters"
          value={formatNumber(summary.winners)}
          trend={`${((summary.winners / Math.max(1, mattersForScenario.length)) * 100).toFixed(0)}% earn more under retainer`}
          trendDirection="up"
        />
        <KPICard
          label="Loser Matters"
          value={formatNumber(summary.losers)}
          trend={`${((summary.losers / Math.max(1, mattersForScenario.length)) * 100).toFixed(0)}% earn less under retainer`}
          trendDirection="down"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          label="Firm-Level Break-Even"
          value={formatCurrency(breakEven.firmLevel)}
          trend="Retainer where total firm revenue is unchanged"
        />
        <KPICard
          label="Per-Matter Median Break-Even"
          value={formatCurrency(breakEven.perMatterMedian)}
          trend="Retainer where half of matters earn more"
        />
        <KPICard
          label="Per-Matter Mean Break-Even"
          value={formatCurrency(breakEven.perMatterMean)}
          trend="Mean monthly density (outlier-sensitive)"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WinnersLosersHistogram
          data={deltaData}
          description={`Per-matter delta at $${retainer}/mo. Red = lose money under retainer, green = gain.`}
        />
        <RevenueDensityHistogram data={densityData} retainer={retainer} />
      </div>

      <BreakEvenByCaseTypeChart data={categoryData} retainer={retainer} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <KPICard
          label="Hourly Monthly Revenue (Mean)"
          value={formatCurrency(predictability.hourlyMean)}
          trend={`Std dev ${formatCurrency(predictability.hourlyStdDev)}`}
        />
        <KPICard
          label="Retainer Monthly Revenue (Mean)"
          value={formatCurrency(predictability.scenarioMean)}
          trend={`Std dev ${formatCurrency(predictability.scenarioStdDev)}`}
          trendDirection={
            predictability.scenarioStdDev < predictability.hourlyStdDev ? "up" : "down"
          }
        />
        <KPICard
          label="Predictability Improvement"
          value={
            predictability.hourlyStdDev > 0
              ? `${(((predictability.hourlyStdDev - predictability.scenarioStdDev) / predictability.hourlyStdDev) * 100).toFixed(0)}%`
              : "—"
          }
          trend="Reduction in monthly revenue std dev"
          trendDirection={
            predictability.scenarioStdDev < predictability.hourlyStdDev ? "up" : "down"
          }
        />
      </div>

      <PredictabilityLineChart data={predictabilityData} />

      <ClientValueSection
        leaderboard={clientLeaderboard}
        monthlyData={monthlyTopClientsData}
        clientKeys={topClientKeys}
        jointMatterPct={jointMatterPct}
      />

      <MatterDeltaTable results={results} retainer={retainer} />
    </div>
  )
}

function ScenarioControls({
  retainer,
  retainerInput,
  setRetainer,
  setRetainerInput,
  onCommit,
  excludeOutliers,
  onToggleOutliers,
  flatFeeCount,
  totalInScopeBeforeOutliers,
  currentInScope,
}: {
  retainer: number
  retainerInput: string
  setRetainer: (v: number) => void
  setRetainerInput: (v: string) => void
  onCommit: (v: number) => void
  excludeOutliers: boolean
  onToggleOutliers: () => void
  flatFeeCount: number
  totalInScopeBeforeOutliers: number
  currentInScope: number
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Scenario Controls</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-5 items-end">
          <div className="flex flex-col gap-2">
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
              onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
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
                const v = Math.max(0, Number(retainerInput) || 0)
                setRetainer(v)
                setRetainerInput(String(v))
                onCommit(v)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur()
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Outliers</Label>
            <Button variant="outline" size="sm" className="h-9" onClick={onToggleOutliers}>
              {excludeOutliers ? "Excluding top 5%" : "Include all matters"}
            </Button>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <strong className="text-foreground">{currentInScope.toLocaleString()}</strong>{" "}
            hourly matters in scope
          </span>
          {excludeOutliers && (
            <span>
              (excluding top{" "}
              {(totalInScopeBeforeOutliers - currentInScope).toLocaleString()} by billable)
            </span>
          )}
          <span>
            <strong className="text-foreground">{flatFeeCount.toLocaleString()}</strong>{" "}
            flat-fee matters excluded (already on flat pricing)
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function ClientValueSection({
  leaderboard,
  monthlyData,
  clientKeys,
  jointMatterPct,
}: {
  leaderboard: Props["clientLeaderboard"]
  monthlyData: Array<Record<string, string | number>>
  clientKeys: string[]
  jointMatterPct: number
}) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? leaderboard : leaderboard.slice(0, 15)

  return (
    <div className="space-y-6">
      <ClientMonthlyRevenueArea data={monthlyData} clientKeys={clientKeys} />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Client Value Leaderboard</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Sorted by average monthly value. {jointMatterPct.toFixed(0)}% of matters have
                multiple parties and are treated as joint clients.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show top 15" : `Show all ${leaderboard.length}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Matters</TableHead>
                <TableHead className="text-right">Months Active</TableHead>
                <TableHead className="text-right">Total Revenue</TableHead>
                <TableHead className="text-right">Avg / Month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.clientKey}>
                  <TableCell className="text-sm font-medium">
                    {c.display}
                    {c.isJoint && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Joint
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">{c.matterCount}</TableCell>
                  <TableCell className="text-right text-sm">
                    {c.monthsActive.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {formatCurrency(c.totalRevenue)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold">
                    {formatCurrency(c.avgMonthlyValue)}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No client data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

type SortKey = "delta" | "billable" | "months" | "hypothetical"

function MatterDeltaTable({
  results,
  retainer,
}: {
  results: ReturnType<typeof runScenario>
  retainer: number
}) {
  const [sortKey, setSortKey] = useState<SortKey>("delta")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [filter, setFilter] = useState<"all" | "winners" | "losers">("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activities, setActivities] = useState<Record<string, Activity[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [limit, setLimit] = useState(50)

  const filtered = useMemo(() => {
    let list = results
    if (filter === "winners") list = list.filter((r) => r.delta > 0)
    if (filter === "losers") list = list.filter((r) => r.delta < 0)
    return [...list].sort((a, b) => {
      const av =
        sortKey === "delta"
          ? a.delta
          : sortKey === "billable"
            ? a.matter.totalBillable
            : sortKey === "months"
              ? a.matter.activeMonths
              : a.hypotheticalRevenue
      const bv =
        sortKey === "delta"
          ? b.delta
          : sortKey === "billable"
            ? b.matter.totalBillable
            : sortKey === "months"
              ? b.matter.activeMonths
              : b.hypotheticalRevenue
      return sortDir === "desc" ? bv - av : av - bv
    })
  }, [results, filter, sortKey, sortDir])

  const visible = filtered.slice(0, limit)

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const toggleExpand = useCallback(
    async (uniqueId: string) => {
      if (expandedId === uniqueId) {
        setExpandedId(null)
        return
      }
      setExpandedId(uniqueId)
      if (!activities[uniqueId]) {
        setLoadingId(uniqueId)
        try {
          const res = await fetch(
            `/api/activities?matterId=${encodeURIComponent(uniqueId)}`,
          )
          const data = await res.json()
          setActivities((prev) => ({ ...prev, [uniqueId]: data.activities ?? [] }))
        } catch {
          setActivities((prev) => ({ ...prev, [uniqueId]: [] }))
        }
        setLoadingId(null)
      }
    },
    [expandedId, activities],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base">Per-Matter Delta</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Comparison at $
              {retainer}/mo retainer. {results.length.toLocaleString()} matters, showing{" "}
              {Math.min(visible.length, filtered.length).toLocaleString()} of{" "}
              {filtered.length.toLocaleString()}.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={filter === "winners" ? "default" : "outline"}
              onClick={() => setFilter("winners")}
            >
              <TrendingUp className="size-3.5 mr-1" />
              Winners
            </Button>
            <Button
              size="sm"
              variant={filter === "losers" ? "default" : "outline"}
              onClick={() => setFilter("losers")}
            >
              <TrendingDown className="size-3.5 mr-1" />
              Losers
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Case</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Case Type</TableHead>
              <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("months")}>
                Active Mo. {sortKey === "months" && (sortDir === "desc" ? "↓" : "↑")}
              </TableHead>
              <TableHead
                className="text-right cursor-pointer"
                onClick={() => toggleSort("billable")}
              >
                Actual (Hourly){" "}
                {sortKey === "billable" && (sortDir === "desc" ? "↓" : "↑")}
              </TableHead>
              <TableHead
                className="text-right cursor-pointer"
                onClick={() => toggleSort("hypothetical")}
              >
                Hypothetical{" "}
                {sortKey === "hypothetical" && (sortDir === "desc" ? "↓" : "↑")}
              </TableHead>
              <TableHead
                className="text-right cursor-pointer"
                onClick={() => toggleSort("delta")}
              >
                Delta {sortKey === "delta" && (sortDir === "desc" ? "↓" : "↑")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const parsed = parseClientsField(r.matter.clients)
              const isExpanded = expandedId === r.matter.unique_id
              const isLoading = loadingId === r.matter.unique_id
              const acts = activities[r.matter.unique_id]
              return (
                <DeltaRow
                  key={r.matter.unique_id}
                  matter={r.matter}
                  clientDisplay={parsed.display}
                  hypothetical={r.hypotheticalRevenue}
                  delta={r.delta}
                  isExpanded={isExpanded}
                  isLoading={isLoading}
                  activities={acts}
                  onToggleExpand={() => toggleExpand(r.matter.unique_id)}
                />
              )
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No matters match this filter
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
  )
}

function DeltaRow({
  matter,
  clientDisplay,
  hypothetical,
  delta,
  isExpanded,
  isLoading,
  activities,
  onToggleExpand,
}: {
  matter: ScenarioMatter
  clientDisplay: string
  hypothetical: number
  delta: number
  isExpanded: boolean
  isLoading: boolean
  activities: Activity[] | undefined
  onToggleExpand: () => void
}) {
  const deltaColor =
    delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-muted-foreground"
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggleExpand}>
        <TableCell className="pl-3">
          {isExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-sm font-medium">
          <div className="max-w-[220px] truncate" title={matter.display_number}>
            {matter.display_number}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          <div className="max-w-[180px] truncate" title={clientDisplay}>
            {clientDisplay}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          <div className="max-w-[140px] truncate" title={matter.mapped_category ?? matter.case_type ?? undefined}>
            {matter.mapped_category ?? matter.case_type ?? "-"}
          </div>
        </TableCell>
        <TableCell className="text-right text-sm">{matter.activeMonths}</TableCell>
        <TableCell className="text-right text-sm">
          {formatCurrency(matter.totalBillable)}
        </TableCell>
        <TableCell className="text-right text-sm">{formatCurrency(hypothetical)}</TableCell>
        <TableCell className={`text-right text-sm font-semibold ${deltaColor}`}>
          <span className="inline-flex items-center gap-1 justify-end">
            <DeltaIcon className="size-3.5" />
            {formatCurrency(delta)}
          </span>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-slate-50 p-0">
            <div className="px-6 py-3 max-h-80 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading activities...
                </div>
              ) : activities && activities.length > 0 ? (
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col className="w-[90px]" />
                    <col className="w-[70px]" />
                    <col className="w-[130px]" />
                    <col />
                    <col className="w-[60px]" />
                    <col className="w-[70px]" />
                    <col className="w-[90px]" />
                  </colgroup>
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left py-1.5 font-medium">Date</th>
                      <th className="text-left py-1.5 font-medium">Type</th>
                      <th className="text-left py-1.5 font-medium">User</th>
                      <th className="text-left py-1.5 font-medium">Description</th>
                      <th className="text-right py-1.5 font-medium">Hours</th>
                      <th className="text-right py-1.5 font-medium">Rate</th>
                      <th className="text-right py-1.5 font-medium">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 text-muted-foreground truncate">
                          {a.activity_date ?? "-"}
                        </td>
                        <td className="py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {a.type === "TimeEntry" ? "Time" : "Expense"}
                          </Badge>
                        </td>
                        <td className="py-1.5 truncate" title={a.user_name ?? undefined}>
                          {a.user_name ?? "-"}
                        </td>
                        <td className="py-1.5 truncate" title={a.description ?? undefined}>
                          {a.description ?? "-"}
                        </td>
                        <td className="py-1.5 text-right">{a.hours || "-"}</td>
                        <td className="py-1.5 text-right">{a.rate ? `$${a.rate}` : "-"}</td>
                        <td className="py-1.5 text-right font-medium">
                          {a.billable_amount ? formatCurrency(a.billable_amount) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground py-4">No activities found</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
