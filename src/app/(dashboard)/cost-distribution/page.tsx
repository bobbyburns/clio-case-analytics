import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters } from "@/lib/queries"
import { computeStats, histogram } from "@/lib/utils/stats"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import { CostHistogram } from "@/components/charts/CostDistributionCharts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default async function CostDistributionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const matters = await fetchMatters(supabase, filters)

  const billableAmounts = matters
    .map((m) => m.total_billable ?? 0)
    .filter((v) => v > 0)

  const stats = computeStats(billableAmounts)
  const bins = histogram(billableAmounts, 20)

  const sortedMatters = [...matters]
    .filter((m) => (m.total_billable ?? 0) > 0)
    .sort((a, b) => (b.total_billable ?? 0) - (a.total_billable ?? 0))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cost Distribution</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Analysis of total billable amounts across {billableAmounts.length} matters
        </p>
      </div>

      <CostHistogram bins={bins} stats={stats} />

      <Card>
        <CardHeader>
          <CardTitle>Statistics</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>All Cases by Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Case Type</TableHead>
                <TableHead>Attorney</TableHead>
                <TableHead className="text-right">Total Billable</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMatters.slice(0, 100).map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.display_number}</TableCell>
                  <TableCell className="max-w-40 truncate">{m.clients ?? "-"}</TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.status === "Open"
                          ? "bg-emerald-50 text-emerald-700"
                          : m.status === "Closed"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {m.status}
                    </span>
                  </TableCell>
                  <TableCell>{m.case_type ?? "-"}</TableCell>
                  <TableCell>{m.responsible_attorney ?? "-"}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(m.total_billable)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(m.total_hours)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {sortedMatters.length > 100 && (
            <p className="text-sm text-muted-foreground mt-3 text-center">
              Showing top 100 of {sortedMatters.length} cases
            </p>
          )}
        </CardContent>
      </Card>
    </div>
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
