import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchMatters, fetchActivitiesForMatters } from "@/lib/queries"
import { ClientsInteractive } from "@/components/ClientsInteractive"
import { AIChatAssistant } from "@/components/AIChatAssistant"
import { parseClientsField } from "@/lib/utils/clients"
import { formatCurrency } from "@/lib/utils/format"
import { KPICard } from "@/components/charts/KPICard"
import type { Activity } from "@/lib/types"

export const maxDuration = 60
export const revalidate = 300

const DAYS_PER_MONTH = 30.44

export interface ClientRow {
  clientKey: string
  display: string
  isJoint: boolean
  totalBillable: number
  monthsActive: number
  avgPerMonth: number
  matterCount: number
  firstActivityDate: string | null
  lastActivityDate: string | null
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)

  let matters: Awaited<ReturnType<typeof fetchMatters>>
  let activities: Activity[]
  try {
    matters = await fetchMatters(supabase, filters)
    activities = await fetchActivitiesForMatters(
      supabase,
      matters.map((m) => m.unique_id),
      { dateFrom: filters.dateFrom, dateTo: filters.dateTo },
    )
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
          <h2 className="font-semibold text-rose-800">Data load failed</h2>
          <p className="mt-2 text-sm text-rose-700 font-mono whitespace-pre-wrap">{msg}</p>
        </div>
      </div>
    )
  }

  // Group activity dates per matter (to find per-matter first/last, then union into client window)
  const activityDatesByMatter = new Map<string, string[]>()
  for (const a of activities) {
    if (!a.activity_date) continue
    const key = String(a.matter_unique_id ?? "")
    if (!key) continue
    const arr = activityDatesByMatter.get(key)
    if (arr) arr.push(a.activity_date)
    else activityDatesByMatter.set(key, [a.activity_date])
  }

  // Aggregate per client: total billable, matter count, collected activity dates
  const byClient = new Map<
    string,
    {
      display: string
      isJoint: boolean
      totalBillable: number
      matterCount: number
      allActivityDates: string[]
    }
  >()

  for (const m of matters) {
    const parsed = parseClientsField(m.clients)
    const billable = m.total_billable ?? 0
    const actDates = activityDatesByMatter.get(m.unique_id) ?? []

    const existing = byClient.get(parsed.key)
    if (existing) {
      existing.totalBillable += billable
      existing.matterCount += 1
      existing.allActivityDates.push(...actDates)
    } else {
      byClient.set(parsed.key, {
        display: parsed.display,
        isJoint: parsed.isJoint,
        totalBillable: billable,
        matterCount: 1,
        allActivityDates: [...actDates],
      })
    }
  }

  const rows: ClientRow[] = []
  for (const [clientKey, v] of byClient.entries()) {
    let firstDate: string | null = null
    let lastDate: string | null = null
    let monthsActive = 0
    if (v.allActivityDates.length > 0) {
      const sorted = [...v.allActivityDates].sort()
      firstDate = sorted[0]
      lastDate = sorted[sorted.length - 1]
      const spanDays =
        (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)
      monthsActive = Math.max(0, spanDays / DAYS_PER_MONTH)
    }
    rows.push({
      clientKey,
      display: v.display,
      isJoint: v.isJoint,
      totalBillable: v.totalBillable,
      monthsActive,
      avgPerMonth: monthsActive > 0 ? v.totalBillable / monthsActive : 0,
      matterCount: v.matterCount,
      firstActivityDate: firstDate,
      lastActivityDate: lastDate,
    })
  }

  // Descending by total billable by default
  rows.sort((a, b) => b.totalBillable - a.totalBillable)

  // Firm-wide averages (across the filtered list)
  const clientCount = rows.length
  const totalRevenue = rows.reduce((s, r) => s + r.totalBillable, 0)
  const totalMatters = rows.reduce((s, r) => s + r.matterCount, 0)
  const avgRevenuePerClient = clientCount > 0 ? totalRevenue / clientCount : 0
  const activeRows = rows.filter((r) => r.monthsActive > 0)
  const avgMonthsActive =
    activeRows.length > 0
      ? activeRows.reduce((s, r) => s + r.monthsActive, 0) / activeRows.length
      : 0
  const avgPerMonthMean =
    activeRows.length > 0
      ? activeRows.reduce((s, r) => s + r.avgPerMonth, 0) / activeRows.length
      : 0
  const totalMonthsAll = rows.reduce((s, r) => s + r.monthsActive, 0)
  const weightedAvgPerMonth = totalMonthsAll > 0 ? totalRevenue / totalMonthsAll : 0

  const pageContext = `Page: Clients
${clientCount} clients across ${totalMatters} matters, total revenue ${formatCurrency(totalRevenue)}.
Average revenue per client: ${formatCurrency(avgRevenuePerClient)}
Average months active per client: ${avgMonthsActive.toFixed(1)} months
Average revenue per active month (mean of per-client ratios): ${formatCurrency(avgPerMonthMean)}
Weighted average ($ per active month across the firm): ${formatCurrency(weightedAvgPerMonth)}

Top 5 clients by revenue: ${rows
    .slice(0, 5)
    .map((r) => `${r.display} (${formatCurrency(r.totalBillable)}, ${r.matterCount} matter(s))`)
    .join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
        <p className="text-muted-foreground text-sm mt-1">
          One row per client, aggregated across all their matters. Months active = first to last
          activity date across the client&rsquo;s matters. Summary KPIs recalculate whenever you
          change filters.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KPICard label="Clients" value={clientCount.toLocaleString()} trend={`${totalMatters.toLocaleString()} matters`} />
        <KPICard label="Total Revenue" value={formatCurrency(totalRevenue)} trend={`${formatCurrency(avgRevenuePerClient)} / client avg`} />
        <KPICard label="Avg Months Active" value={avgMonthsActive.toFixed(1)} trend="mean per client" />
        <KPICard label="Avg $ / Active Month" value={formatCurrency(avgPerMonthMean)} trend="mean of per-client ratios" />
        <KPICard label="Weighted $ / Month" value={formatCurrency(weightedAvgPerMonth)} trend="total rev ÷ total months" />
      </div>

      <ClientsInteractive rows={rows} />

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
