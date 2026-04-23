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
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { KPICard } from "@/components/charts/KPICard"
import {
  RevenueDensityHistogram,
  WinnersLosersHistogram,
} from "@/components/charts/PricingModelCharts"
import { formatCurrency } from "@/lib/utils/format"
import { mean, median } from "@/lib/utils/stats"
import { densityHistogram, deltaHistogram } from "@/lib/utils/pricing"
import type { ClientRow } from "@/app/(dashboard)/clients/page"

type SortKey =
  | "display"
  | "totalBillable"
  | "monthsActive"
  | "avgPerMonth"
  | "matterCount"
  | "delta"
type ScenarioFilter = "all" | "winners" | "losers"

interface ScenarioRow extends ClientRow {
  activeMonthsCeil: number
  hypothetical: number
  delta: number
  isWinner: boolean
}

interface Props {
  rows: ClientRow[]
  initialRetainer: number
}

export function ClientsInteractive({ rows, initialRetainer }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [retainer, setRetainer] = useState(initialRetainer)
  const [retainerInput, setRetainerInput] = useState(String(initialRetainer))
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioFilter>("all")
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("totalBillable")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [limit, setLimit] = useState(100)

  const syncRetainerToUrl = useCallback(
    (value: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value !== 1500) params.set("retainer", String(value))
      else params.delete("retainer")
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const scenarioRows = useMemo<ScenarioRow[]>(() => {
    return rows.map((r) => {
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
  }, [rows, retainer])

  const summary = useMemo(() => {
    const totalActual = scenarioRows.reduce((s, r) => s + r.totalBillable, 0)
    const totalHypothetical = scenarioRows.reduce((s, r) => s + r.hypothetical, 0)
    const winners = scenarioRows.filter((r) => r.delta > 0)
    const losers = scenarioRows.filter((r) => r.delta < 0)
    const revenueCaptured = winners.reduce((s, r) => s + r.delta, 0)
    const revenueAtRisk = losers.reduce((s, r) => s + -r.delta, 0)
    const totalMonths = scenarioRows.reduce((s, r) => s + r.activeMonthsCeil, 0)
    const densities = scenarioRows
      .filter((r) => r.monthsActive > 0 && r.totalBillable > 0)
      .map((r) => r.totalBillable / r.monthsActive)
    const firmBreakEven = totalMonths > 0 ? totalActual / totalMonths : 0
    const medianBreakEven = median(densities)
    const meanBreakEven = mean(densities)

    // Top-10 loser concentration: what % of revenue-at-risk comes from the 10 biggest losers?
    const sortedLosersByImpact = [...losers].sort((a, b) => -a.delta - -b.delta)
    const top10LoserImpact = sortedLosersByImpact
      .slice(0, 10)
      .reduce((s, r) => s + -r.delta, 0)
    const top10LoserShare = revenueAtRisk > 0 ? top10LoserImpact / revenueAtRisk : 0

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
    }
  }, [scenarioRows])

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

  return (
    <div className="space-y-6">
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
          trend="retainer where firm revenue is unchanged"
        />
        <KPICard
          label="Per-Client Median Break-Even"
          value={formatCurrency(summary.medianBreakEven)}
          trend="retainer where half of clients earn more"
        />
        <KPICard
          label="Per-Client Mean Break-Even"
          value={formatCurrency(summary.meanBreakEven)}
          trend="mean of per-client $/month (outlier-sensitive)"
        />
      </div>

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
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort("display")}
                >
                  Client{indicator("display")}
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <ScenarioClientRow key={r.clientKey} row={r} />
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
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

function ScenarioClientRow({ row: r }: { row: ScenarioRow }) {
  const isLoser = r.delta < 0
  const DeltaIcon = r.delta > 0 ? TrendingUp : r.delta < 0 ? TrendingDown : Minus
  const deltaColor =
    r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-rose-600" : "text-muted-foreground"
  return (
    <TableRow className={isLoser ? "bg-rose-50/40" : ""}>
      <TableCell className="text-sm font-medium">
        <div className="max-w-[260px] truncate" title={r.display}>
          {r.display}
        </div>
        {r.isJoint && (
          <Badge variant="outline" className="mt-1 text-[10px]">
            Joint
          </Badge>
        )}
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
    </TableRow>
  )
}
