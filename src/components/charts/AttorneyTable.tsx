"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpDown } from "lucide-react"

interface AttorneyRow {
  name: string
  caseCount: number
  totalRevenue: number
  avgCost: number
  avgDuration: number
}

type SortKey = keyof AttorneyRow
type SortDir = "asc" | "desc"

export function AttorneyTableClient({ data }: { data: AttorneyRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalRevenue")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    return sortDir === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number)
  })

  const SortableHead = ({ label, sortKeyProp }: { label: string; sortKeyProp: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/50"
      onClick={() => toggleSort(sortKeyProp)}
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="size-3 text-muted-foreground" />
      </span>
    </TableHead>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attorney Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Attorney" sortKeyProp="name" />
              <SortableHead label="Cases" sortKeyProp="caseCount" />
              <SortableHead label="Total Revenue" sortKeyProp="totalRevenue" />
              <SortableHead label="Avg Cost / Case" sortKeyProp="avgCost" />
              <SortableHead label="Avg Duration" sortKeyProp="avgDuration" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.caseCount}</TableCell>
                <TableCell>${row.totalRevenue.toLocaleString()}</TableCell>
                <TableCell>${row.avgCost.toLocaleString()}</TableCell>
                <TableCell>
                  {row.avgDuration > 0
                    ? `${(row.avgDuration / 30.44).toFixed(1)} mo`
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
