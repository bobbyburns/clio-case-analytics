import { createClient } from "@/lib/supabase/server"
import { parseFilters, fetchActivities } from "@/lib/queries"
import { formatCurrency, formatNumber } from "@/lib/utils/format"
import {
  ActivityTypePie,
  BillableVsNonBillable,
  TopUsersByBillable,
  FlatRateBreakdown,
} from "@/components/charts/ActivityCharts"
import { AIChatAssistant } from "@/components/AIChatAssistant"

export default async function ActivityPatternsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const filters = parseFilters(params)
  const activities = await fetchActivities(supabase, filters)

  // Activity type split
  const timeEntries = activities.filter((a) => a.type === "TimeEntry")
  const expenseEntries = activities.filter((a) => a.type === "ExpenseEntry")
  const typePieData = [
    { name: "Time Entries", value: timeEntries.length },
    { name: "Expense Entries", value: expenseEntries.length },
  ]

  // Billable vs non-billable
  const totalBillableHours = timeEntries.reduce(
    (sum, a) => sum + (a.billable_amount != null && a.billable_amount > 0 ? (a.hours ?? 0) : 0),
    0
  )
  const totalNonBillableHours = timeEntries.reduce(
    (sum, a) =>
      sum +
      (a.nonbillable_amount != null && a.nonbillable_amount > 0 ? (a.hours ?? 0) : 0),
    0
  )
  const billableData = [
    {
      name: "Hours",
      billable: Math.round(totalBillableHours * 10) / 10,
      nonBillable: Math.round(totalNonBillableHours * 10) / 10,
    },
  ]

  // Top 10 users by billable amount
  const userBillable = new Map<string, number>()
  for (const a of activities) {
    if (a.user_name && (a.billable_amount ?? 0) > 0) {
      userBillable.set(
        a.user_name,
        (userBillable.get(a.user_name) ?? 0) + (a.billable_amount ?? 0)
      )
    }
  }
  const topUsers = [...userBillable.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))

  // Flat rate vs hourly
  const flatRateCount = timeEntries.filter((a) => a.flat_rate === true).length
  const hourlyCount = timeEntries.filter((a) => a.flat_rate === false || a.flat_rate == null).length
  const rateData = [
    { name: "Flat Rate", value: flatRateCount },
    { name: "Hourly", value: hourlyCount },
  ]

  const totalBillableAmount = activities.reduce(
    (sum, a) => sum + (a.billable_amount ?? 0),
    0
  )

  const pageContext = `Page: Activity Patterns
Analyzing ${formatNumber(activities.length)} activity entries.

Activity Type Split:
- Time Entries: ${formatNumber(timeEntries.length)}
- Expense Entries: ${formatNumber(expenseEntries.length)}

Billable vs Non-Billable Hours:
- Billable Hours: ${billableData[0].billable}
- Non-Billable Hours: ${billableData[0].nonBillable}
- Billable Ratio: ${((billableData[0].billable / (billableData[0].billable + billableData[0].nonBillable)) * 100).toFixed(1)}%

Total Billable Amount: ${formatCurrency(totalBillableAmount)}

Rate Structure:
- Flat Rate Entries: ${formatNumber(flatRateCount)}
- Hourly Entries: ${formatNumber(hourlyCount)}

Top Users by Billable Amount: ${topUsers.map((u) => `${u.name}: ${formatCurrency(u.amount)}`).join("; ")}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity Patterns</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Analysis of {activities.length} activity entries
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
