import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchActivityPatternsRollup } from "@/lib/queries"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import {
  ActivityTypePie,
  BillableVsNonBillable,
  TopUsersByBillable,
  FlatRateBreakdown,
} from "@/components/charts/ActivityCharts"
import { AIChatAssistant } from "@/components/AIChatAssistant"

export const maxDuration = 60
export const revalidate = 300

export default async function ActivityPatternsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const t0 = Date.now()
  const rollup = await fetchActivityPatternsRollup(supabase, filters)
  console.log(`[activity-patterns] rollup in ${Date.now() - t0}ms (${rollup.total_entries} entries)`)

  const typePieData = [
    { name: "Time Entries", value: Number(rollup.time_entries) },
    { name: "Expense Entries", value: Number(rollup.expense_entries) },
  ]

  const billableData = [
    {
      name: "Hours",
      billable: Math.round(Number(rollup.billable_hours) * 10) / 10,
      nonBillable: Math.round(Number(rollup.nonbillable_hours) * 10) / 10,
    },
  ]

  const topUsers = rollup.top_users.map((u) => ({
    name: u.user_name,
    amount: Number(u.amount),
  }))

  const rateData = [
    { name: "Flat Rate", value: Number(rollup.flat_rate_count) },
    { name: "Hourly", value: Number(rollup.hourly_count) },
  ]

  const totalBillableAmount = Number(rollup.total_billable_amount)
  const billableTotal = billableData[0].billable + billableData[0].nonBillable
  const billableRatio = billableTotal > 0
    ? ((billableData[0].billable / billableTotal) * 100).toFixed(1)
    : "0.0"

  const pageContext = `Page: Activity Patterns
Analyzing ${formatNumber(rollup.total_entries)} activity entries.

Activity Type Split:
- Time Entries: ${formatNumber(rollup.time_entries)}
- Expense Entries: ${formatNumber(rollup.expense_entries)}

Billable vs Non-Billable Hours:
- Billable Hours: ${billableData[0].billable}
- Non-Billable Hours: ${billableData[0].nonBillable}
- Billable Ratio: ${billableRatio}%

Total Billable Amount: ${formatCurrency(totalBillableAmount)}

Rate Structure:
- Flat Rate Entries: ${formatNumber(rollup.flat_rate_count)}
- Hourly Entries: ${formatNumber(rollup.hourly_count)}

Top Users by Billable Amount: ${topUsers.map((u) => `${u.name}: ${formatCurrency(u.amount)}`).join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity Patterns</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Analysis of {rollup.total_entries} activity entries
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivityTypePie data={typePieData} />
        <FlatRateBreakdown data={rateData} />
        <BillableVsNonBillable data={billableData} />
        <TopUsersByBillable data={topUsers} />
      </div>

      <AIChatAssistant pageContext={pageContext} />
    </div>
  )
}
