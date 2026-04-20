"use client"

import { useState, useMemo, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  ChevronDown, ChevronRight, EyeOff, Eye, CheckSquare, Square, X, Loader2,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { computeStats, histogram } from "@/lib/utils/stats"
import type { Matter, Activity } from "@/lib/types"

const BUCKET_COLORS = {
  default: "#3b82f6",
  selected: "#1d4ed8",
  disregarded: "#94a3b8",
}

interface Props {
  matters: Matter[]
  pageContext: string
}

export function CostDistributionInteractive({ matters: initialMatters }: Props) {
  const [matters, setMatters] = useState(initialMatters)
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activities, setActivities] = useState<Record<string, Activity[]>>({})
  const [loadingActivities, setLoadingActivities] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [showDisregarded, setShowDisregarded] = useState(false)

  // Compute stats on non-disregarded matters
  const activeMattersList = useMemo(
    () => matters.filter((m) => !m.disregarded),
    [matters]
  )
  const billableAmounts = useMemo(
    () => activeMattersList.map((m) => m.total_billable ?? 0).filter((v) => v > 0),
    [activeMattersList]
  )
  const stats = useMemo(() => computeStats(billableAmounts), [billableAmounts])
  const bins = useMemo(() => histogram(billableAmounts, 20), [billableAmounts])

  // Filter matters by selected bucket
  const displayMatters = useMemo(() => {
    let list = showDisregarded ? matters : activeMattersList
    list = list.filter((m) => (m.total_billable ?? 0) > 0)

    if (selectedBucket) {
      const bin = bins.find((b) => b.label === selectedBucket)
      if (bin) {
        list = list.filter((m) => {
          const v = m.total_billable ?? 0
          return v >= bin.binStart && v < bin.binEnd
        })
      }
    }
    return list.sort((a, b) => (b.total_billable ?? 0) - (a.total_billable ?? 0))
  }, [matters, activeMattersList, selectedBucket, bins, showDisregarded])

  const disregardedCount = useMemo(
    () => matters.filter((m) => m.disregarded).length,
    [matters]
  )

  // Toggle expand and fetch activities
  const toggleExpand = useCallback(async (uniqueId: string) => {
    if (expandedId === uniqueId) {
      setExpandedId(null)
      return
    }
    setExpandedId(uniqueId)

    if (!activities[uniqueId]) {
      setLoadingActivities(uniqueId)
      try {
        const res = await fetch(
          `/api/activities?matterId=${encodeURIComponent(uniqueId)}`
        )
        const data = await res.json()
        setActivities((prev) => ({ ...prev, [uniqueId]: data.activities ?? [] }))
      } catch {
        setActivities((prev) => ({ ...prev, [uniqueId]: [] }))
      }
      setLoadingActivities(null)
    }
  }, [expandedId, activities])

  // Single disregard toggle
  const toggleDisregard = useCallback(async (uniqueId: string, current: boolean) => {
    const newVal = !current
    // Optimistic update
    setMatters((prev) =>
      prev.map((m) => (m.unique_id === uniqueId ? { ...m, disregarded: newVal } : m))
    )
    await fetch("/api/disregard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [uniqueId], disregarded: newVal }),
    })
  }, [])

  // Bulk disregard
  const bulkDisregard = useCallback(async (disregarded: boolean) => {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)
    setMatters((prev) =>
      prev.map((m) => (ids.includes(m.unique_id) ? { ...m, disregarded } : m))
    )
    await fetch("/api/disregard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, disregarded }),
    })
    setSelectedIds(new Set())
    setBulkSaving(false)
  }, [selectedIds])

  // Select all visible
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === displayMatters.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(displayMatters.map((m) => m.unique_id)))
    }
  }, [displayMatters, selectedIds])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <div className="space-y-6">
      {/* Histogram */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cost Distribution Histogram</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Click a bar to filter the table below.
                {selectedBucket && (
                  <button
                    className="ml-2 text-blue-600 hover:underline"
                    onClick={() => setSelectedBucket(null)}
                  >
                    Clear filter
                  </button>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {disregardedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisregarded(!showDisregarded)}
                >
                  {showDisregarded ? <Eye className="size-3.5 mr-1" /> : <EyeOff className="size-3.5 mr-1" />}
                  {showDisregarded ? "Hide" : "Show"} {disregardedCount} disregarded
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={bins} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value) => [`${value} cases`, "Cases"]}
                labelFormatter={(label) => `Bucket: ${label}`}
              />
              {stats.p50 > 0 && (
                <ReferenceLine
                  x={bins.find((b) => stats.p50 >= b.binStart && stats.p50 < b.binEnd)?.label}
                  stroke="#6366f1"
                  strokeDasharray="3 3"
                  label={{ value: "P50", position: "top", fontSize: 10 }}
                />
              )}
              <Bar
                dataKey="count"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={(_data, index) => {
                  const clickedLabel = bins[index]?.label
                  if (!clickedLabel) return
                  setSelectedBucket(
                    selectedBucket === clickedLabel ? null : clickedLabel
                  )
                  setSelectedIds(new Set())
                }}
              >
                {bins.map((bin) => (
                  <Cell
                    key={bin.label}
                    fill={
                      selectedBucket === bin.label
                        ? BUCKET_COLORS.selected
                        : BUCKET_COLORS.default
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Statistics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Statistics
            {disregardedCount > 0 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                (excluding {disregardedCount} disregarded)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <StatItem label="Count" value={formatNumber(stats.count)} />
            <StatItem label="Min" value={formatCurrency(stats.min)} />
            <StatItem label="P10" value={formatCurrency(stats.p10)} />
            <StatItem label="P25" value={formatCurrency(stats.p25)} />
            <StatItem label="Median (P50)" value={formatCurrency(stats.p50)} />
            <StatItem label="P75" value={formatCurrency(stats.p75)} />
            <StatItem label="P90" value={formatCurrency(stats.p90)} />
            <StatItem label="Max" value={formatCurrency(stats.max)} />
            <StatItem label="Mean" value={formatCurrency(stats.mean)} />
            <StatItem label="Std Dev" value={formatCurrency(stats.stdDev)} />
          </div>
        </CardContent>
      </Card>

      {/* Cases table with bucket filter, expand, disregard */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">
                {selectedBucket ? `Cases in ${selectedBucket}` : "All Cases by Cost"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {displayMatters.length} cases
                {selectedBucket && (
                  <button
                    className="ml-2 text-blue-600 hover:underline text-xs"
                    onClick={() => setSelectedBucket(null)}
                  >
                    Show all
                  </button>
                )}
              </p>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkDisregard(true)}
                  disabled={bulkSaving}
                >
                  {bulkSaving ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <EyeOff className="size-3.5 mr-1" />
                  )}
                  Disregard Selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkDisregard(false)}
                  disabled={bulkSaving}
                >
                  <Eye className="size-3.5 mr-1" />
                  Restore Selected
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <button onClick={toggleSelectAll} className="p-1">
                    {selectedIds.size === displayMatters.length && displayMatters.length > 0 ? (
                      <CheckSquare className="size-4 text-blue-600" />
                    ) : (
                      <Square className="size-4 text-muted-foreground" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="w-8" />
                <TableHead>Case</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Case Type</TableHead>
                <TableHead>Attorney</TableHead>
                <TableHead className="text-right">Total Billable</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayMatters.map((m) => (
                <CaseRow
                  key={m.unique_id}
                  matter={m}
                  isExpanded={expandedId === m.unique_id}
                  isSelected={selectedIds.has(m.unique_id)}
                  isLoadingActivities={loadingActivities === m.unique_id}
                  activities={activities[m.unique_id]}
                  onToggleExpand={() => toggleExpand(m.unique_id)}
                  onToggleSelect={() => toggleSelect(m.unique_id)}
                  onToggleDisregard={() =>
                    toggleDisregard(m.unique_id, !!m.disregarded)
                  }
                />
              ))}
              {displayMatters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    No cases in this range
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

function CaseRow({
  matter: m,
  isExpanded,
  isSelected,
  isLoadingActivities,
  activities,
  onToggleExpand,
  onToggleSelect,
  onToggleDisregard,
}: {
  matter: Matter
  isExpanded: boolean
  isSelected: boolean
  isLoadingActivities: boolean
  activities: Activity[] | undefined
  onToggleExpand: () => void
  onToggleSelect: () => void
  onToggleDisregard: () => void
}) {
  return (
    <>
      <TableRow
        className={`cursor-pointer ${m.disregarded ? "opacity-40" : ""} ${isSelected ? "bg-blue-50" : ""}`}
      >
        <TableCell>
          <button onClick={(e) => { e.stopPropagation(); onToggleSelect() }} className="p-1">
            {isSelected ? (
              <CheckSquare className="size-4 text-blue-600" />
            ) : (
              <Square className="size-4 text-muted-foreground" />
            )}
          </button>
        </TableCell>
        <TableCell>
          <button onClick={onToggleExpand} className="p-1">
            {isExpanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </button>
        </TableCell>
        <TableCell className="font-medium text-sm" onClick={onToggleExpand}>
          {m.display_number}
          {m.disregarded && (
            <Badge variant="outline" className="ml-2 text-[10px]">
              Disregarded
            </Badge>
          )}
        </TableCell>
        <TableCell className="max-w-32 truncate text-sm" onClick={onToggleExpand}>
          {m.clients ?? "-"}
        </TableCell>
        <TableCell onClick={onToggleExpand}>
          <StatusBadge status={m.status} />
        </TableCell>
        <TableCell className="text-sm" onClick={onToggleExpand}>{m.case_type ?? "-"}</TableCell>
        <TableCell className="text-sm" onClick={onToggleExpand}>{m.responsible_attorney ?? "-"}</TableCell>
        <TableCell className="text-right font-medium text-sm" onClick={onToggleExpand}>
          {formatCurrency(m.total_billable)}
        </TableCell>
        <TableCell className="text-right text-sm" onClick={onToggleExpand}>
          {formatNumber(m.total_hours)}
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => { e.stopPropagation(); onToggleDisregard() }}
          >
            {m.disregarded ? (
              <>
                <Eye className="size-3 mr-1" /> Restore
              </>
            ) : (
              <>
                <EyeOff className="size-3 mr-1" /> Disregard
              </>
            )}
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={10} className="bg-slate-50 p-0">
            <div className="px-6 py-3 max-h-80 overflow-y-auto">
              {isLoadingActivities ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading activities...
                </div>
              ) : activities && activities.length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground border-b">
                      <th className="text-left py-1.5 font-medium">Date</th>
                      <th className="text-left py-1.5 font-medium">Type</th>
                      <th className="text-left py-1.5 font-medium">User</th>
                      <th className="text-left py-1.5 font-medium max-w-xs">Description</th>
                      <th className="text-right py-1.5 font-medium">Hours</th>
                      <th className="text-right py-1.5 font-medium">Rate</th>
                      <th className="text-right py-1.5 font-medium">Billable</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1.5 text-muted-foreground">{a.activity_date ?? "-"}</td>
                        <td className="py-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {a.type === "TimeEntry" ? "Time" : "Expense"}
                          </Badge>
                        </td>
                        <td className="py-1.5">{a.user_name ?? "-"}</td>
                        <td className="py-1.5 max-w-xs truncate">{a.description ?? "-"}</td>
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

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Open"
      ? "bg-emerald-50 text-emerald-700"
      : status === "Closed"
        ? "bg-slate-100 text-slate-600"
        : "bg-amber-50 text-amber-700"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  )
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  )
}
