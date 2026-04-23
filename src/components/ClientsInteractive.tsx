"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { formatCurrency } from "@/lib/utils/format"
import type { ClientRow } from "@/app/(dashboard)/clients/page"

type SortKey = "display" | "totalBillable" | "monthsActive" | "avgPerMonth" | "matterCount"

export function ClientsInteractive({ rows }: { rows: ClientRow[] }) {
  const [search, setSearch] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("totalBillable")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [limit, setLimit] = useState(100)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? rows.filter((r) => r.display.toLowerCase().includes(q))
      : rows.slice()

    list.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv)
      }
      return sortDir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return list
  }, [rows, search, sortKey, sortDir])

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

  return (
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
              {filtered.length > visible.length && (
                <> · showing {visible.length.toLocaleString()} of {filtered.length.toLocaleString()}</>
              )}
            </p>
          </div>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client name…"
            className="w-64 h-9"
          />
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
              <TableHead>First Activity</TableHead>
              <TableHead>Last Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.clientKey}>
                <TableCell className="text-sm font-medium">
                  <div className="max-w-[280px] truncate" title={r.display}>
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
                <TableCell className="text-xs text-muted-foreground">
                  {r.firstActivityDate ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.lastActivityDate ?? "—"}
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
  )
}
