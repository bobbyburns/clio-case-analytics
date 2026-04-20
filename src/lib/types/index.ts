export interface Matter {
  id: number
  unique_id: string
  display_number: string
  description: string | null
  status: "Open" | "Closed" | "Pending"
  open_date: string | null
  close_date: string | null
  duration_days: number | null
  county: string | null
  practice_area: string | null
  case_type: string | null
  number_of_children: number | null
  date_of_marriage: string | null
  responsible_attorney: string | null
  originating_attorney: string | null
  opposing_counsel: string | null
  has_opposing_counsel: boolean | null
  retainer_type: string | null
  scope_of_representation: string | null
  case_number: string | null
  clients: string | null
  billable: boolean | null
  total_billable: number | null
  total_nonbillable: number | null
  total_expenses: number | null
  total_hours: number | null
  activity_count: number | null
  disregarded: boolean | null
  mapped_category: string | null
}

export interface Activity {
  id: number
  clio_id: number | null
  type: "TimeEntry" | "ExpenseEntry"
  activity_date: string | null
  hours: number | null
  description: string | null
  matter_display_number: string | null
  matter_unique_id: number | null
  flat_rate: boolean | null
  rate: number | null
  billable_amount: number | null
  nonbillable_amount: number | null
  user_name: string | null
  bill_state: string | null
  bill_number: string | null
  expense_category: string | null
}

export interface FilterState {
  status: string[]
  caseType: string[]
  county: string[]
  attorney: string[]
  dateFrom: string | null
  dateTo: string | null
  minBillable: number | null
  maxBillable: number | null
}

export interface StatsResult {
  count: number
  min: number
  max: number
  mean: number
  median: number
  stdDev: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface HistogramBin {
  binStart: number
  binEnd: number
  label: string
  count: number
}
