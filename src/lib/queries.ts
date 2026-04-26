import type { SupabaseClient } from "@supabase/supabase-js"
import type { FilterState, Matter, Activity } from "@/lib/types"
import { isExcludedClient } from "@/lib/utils/clients"

export function parseFilters(searchParams: Record<string, string | string[] | undefined>): FilterState {
  const toArray = (v: string | string[] | undefined): string[] => {
    if (!v) return []
    if (Array.isArray(v)) return v.filter(Boolean)
    return v.split(",").filter(Boolean)
  }
  return {
    status: toArray(searchParams.status),
    caseType: toArray(searchParams.caseType),
    county: toArray(searchParams.county),
    attorney: toArray(searchParams.attorney),
    dateFrom: (typeof searchParams.dateFrom === "string" ? searchParams.dateFrom : null) || null,
    dateTo: (typeof searchParams.dateTo === "string" ? searchParams.dateTo : null) || null,
    minBillable: typeof searchParams.minBillable === "string" ? Number(searchParams.minBillable) || null : null,
    maxBillable: typeof searchParams.maxBillable === "string" ? Number(searchParams.maxBillable) || null : null,
  }
}

const MATTER_COLUMNS = "id,unique_id,display_number,status,open_date,close_date,duration_days,county,case_type,number_of_children,responsible_attorney,has_opposing_counsel,retainer_type,clients,total_billable,total_hours,activity_count,disregarded,mapped_category"

function buildMatterQuery(supabase: SupabaseClient, filters: FilterState, includeDisregarded = false) {
  let q = supabase.from("clio_matters").select(MATTER_COLUMNS)
  if (!includeDisregarded) q = q.or("disregarded.is.null,disregarded.eq.false")
  if (filters.status.length > 0) q = q.in("status", filters.status)
  if (filters.caseType.length > 0) {
    const hasNotMapped = filters.caseType.includes("Not Mapped")
    const mapped = filters.caseType.filter((t) => t !== "Not Mapped")
    if (hasNotMapped && mapped.length > 0) {
      q = q.or(`mapped_category.in.(${mapped.join(",")}),mapped_category.is.null`)
    } else if (hasNotMapped) {
      q = q.is("mapped_category", null)
    } else {
      q = q.in("mapped_category", mapped)
    }
  }
  if (filters.county.length > 0) q = q.in("county", filters.county)
  if (filters.attorney.length > 0) q = q.in("responsible_attorney", filters.attorney)
  if (filters.dateFrom) q = q.gte("open_date", filters.dateFrom)
  if (filters.dateTo) q = q.lte("open_date", filters.dateTo)
  if (filters.minBillable != null && filters.minBillable > 0) q = q.gte("total_billable", filters.minBillable)
  if (filters.maxBillable != null && filters.maxBillable > 0) q = q.lte("total_billable", filters.maxBillable)
  return q
}

export async function fetchMatters(
  supabase: SupabaseClient,
  filters: FilterState,
  includeDisregarded = false,
): Promise<Matter[]> {
  const all: Matter[] = []
  const PAGE = 2000
  let offset = 0
  while (true) {
    const { data, error } = await buildMatterQuery(supabase, filters, includeDisregarded)
      .order("open_date", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as unknown as Matter[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  // Globally exclude administrative/placeholder-client matters from all analysis.
  return all.filter((m) => !isExcludedClient(m.clients))
}

export async function fetchActivities(
  supabase: SupabaseClient,
  filters: FilterState
): Promise<Activity[]> {
  let matterIds: string[] | null = null
  if (
    filters.status.length > 0 ||
    filters.caseType.length > 0 ||
    filters.county.length > 0 ||
    filters.attorney.length > 0
  ) {
    const matters = await fetchMatters(supabase, filters)
    matterIds = matters.map((m) => m.unique_id)
    if (matterIds.length === 0) return []
  }

  const all: Activity[] = []
  const PAGE = 2000
  let offset = 0
  const ACTIVITY_COLUMNS = "matter_unique_id,activity_date,billable_amount,nonbillable_amount,flat_rate,hours,rate,type,user_name,bill_state"
  while (true) {
    let q = supabase.from("clio_activities").select(ACTIVITY_COLUMNS)
    if (matterIds) q = q.in("matter_unique_id", matterIds)
    if (filters.dateFrom) q = q.gte("activity_date", filters.dateFrom)
    if (filters.dateTo) q = q.lte("activity_date", filters.dateTo)
    const { data, error } = await q
      .order("activity_date", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as unknown as Activity[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

/** Fetch only the activity columns a caller needs, scoped to the supplied matter IDs.
 *  Chunks the IN() clause and runs chunks in parallel with bounded concurrency
 *  (8 by default), so total latency is ~one chunk's worth regardless of N. */
export async function fetchActivitiesForMatters(
  supabase: SupabaseClient,
  matterIds: string[],
  options: {
    dateFrom?: string | null
    dateTo?: string | null
    columns?: string
    concurrency?: number
  } = {},
): Promise<Activity[]> {
  if (matterIds.length === 0) return []
  const {
    dateFrom = null,
    dateTo = null,
    columns = "matter_unique_id,activity_date,billable_amount,flat_rate,hours,rate,type,user_name,description,bill_state,nonbillable_amount",
    concurrency = 8,
  } = options

  const ID_CHUNK = 300
  const PAGE = 2000
  const chunks: string[][] = []
  for (let i = 0; i < matterIds.length; i += ID_CHUNK) {
    chunks.push(matterIds.slice(i, i + ID_CHUNK))
  }

  async function fetchChunk(idChunk: string[]): Promise<Activity[]> {
    const out: Activity[] = []
    let offset = 0
    while (true) {
      let q = supabase.from("clio_activities").select(columns).in("matter_unique_id", idChunk)
      if (dateFrom) q = q.gte("activity_date", dateFrom)
      if (dateTo) q = q.lte("activity_date", dateTo)
      const { data, error } = await q
        .order("activity_date", { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      out.push(...(data as unknown as Activity[]))
      if (data.length < PAGE) break
      offset += PAGE
    }
    return out
  }

  const all: Activity[] = []
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(fetchChunk))
    for (const arr of results) all.push(...arr)
  }
  return all
}

export interface MatterRollup {
  matter_unique_id: string
  total_billable: number
  total_nonbillable: number
  total_hours: number
  flat_rate_billable: number
  hourly_billable: number
  legacy_billable: number
  activity_count: number
  first_activity_date: string | null
  last_activity_date: string | null
}

/** Page-through an RPC that returns rows. PostgREST caps responses at the
 *  project's max-rows (default 1000), silently truncating large rollups. */
async function pagedRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .rpc(fn, args)
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = (data as T[]) ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
    offset += PAGE
  }
  return all
}

/** One-shot per-matter rollup — replaces fetchActivitiesForMatters() in the
 *  Pricing Model and Clients pages. Server-side aggregation drops the wire size
 *  from ~70k activity rows to ~2k matter rows. */
export async function fetchMatterRollup(
  supabase: SupabaseClient,
  filters: Pick<FilterState, "dateFrom" | "dateTo">,
): Promise<Map<string, MatterRollup>> {
  const rows = await pagedRpc<MatterRollup>(supabase, "matter_activity_rollup", {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
  })
  const map = new Map<string, MatterRollup>()
  for (const row of rows) {
    map.set(row.matter_unique_id, row)
  }
  return map
}

export async function fetchMonthlyFirmRevenue(
  supabase: SupabaseClient,
  filters: Pick<FilterState, "dateFrom" | "dateTo">,
  hourlyOnly = false,
): Promise<Map<string, number>> {
  const rows = await pagedRpc<{ month: string; billable: number }>(
    supabase,
    "monthly_firm_revenue",
    {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      hourly_only: hourlyOnly,
    },
  )
  const map = new Map<string, number>()
  for (const row of rows) {
    map.set(row.month, Number(row.billable))
  }
  return map
}

export interface MatterMonthlyBillable {
  matter_unique_id: string
  month: string
  billable: number
}

export async function fetchMatterMonthlyBillable(
  supabase: SupabaseClient,
  filters: Pick<FilterState, "dateFrom" | "dateTo">,
  hourlyOnly = false,
): Promise<MatterMonthlyBillable[]> {
  const rows = await pagedRpc<MatterMonthlyBillable>(
    supabase,
    "matter_monthly_billable",
    {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      hourly_only: hourlyOnly,
    },
  )
  return rows.map((r) => ({
    matter_unique_id: r.matter_unique_id,
    month: r.month,
    billable: Number(r.billable),
  }))
}

export interface MatterWeeklyBillable {
  matter_unique_id: string
  week_start: string
  billable: number
  hours: number
  activity_count: number
}

export async function fetchMatterWeeklyBillable(
  supabase: SupabaseClient,
  filters: Pick<FilterState, "dateFrom" | "dateTo">,
): Promise<MatterWeeklyBillable[]> {
  const rows = await pagedRpc<MatterWeeklyBillable>(
    supabase,
    "matter_weekly_billable",
    {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
    },
  )
  return rows.map((r) => ({
    matter_unique_id: r.matter_unique_id,
    week_start: r.week_start,
    billable: Number(r.billable),
    hours: Number(r.hours),
    activity_count: Number(r.activity_count),
  }))
}

export interface SpikeActivityRow {
  activity_date: string | null
  type: string
  user_name: string | null
  description: string | null
  hours: number
  rate: number
  billable_amount: number
  expense_category: string | null
}

export async function fetchSpikeActivities(
  supabase: SupabaseClient,
  matterId: string,
  weekStart: string,
): Promise<SpikeActivityRow[]> {
  const { data, error } = await supabase.rpc("spike_activities", {
    p_matter_id: matterId,
    p_week_start: weekStart,
  })
  if (error) throw error
  return ((data as SpikeActivityRow[]) ?? []).map((r) => ({
    ...r,
    hours: Number(r.hours),
    rate: Number(r.rate),
    billable_amount: Number(r.billable_amount),
  }))
}

export interface SpikeAnalysisRecord {
  matter_unique_id: string
  week_start: string
  primary_event: string
  secondary_events: string[]
  narrative: string
  evidence_quotes: string[]
  model_used: string | null
  analyzed_at: string
}

export async function fetchSpikeAnalyses(
  supabase: SupabaseClient,
): Promise<Map<string, SpikeAnalysisRecord>> {
  const all: SpikeAnalysisRecord[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from("clio_spike_analyses")
      .select("*")
      .order("analyzed_at", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as SpikeAnalysisRecord[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  const map = new Map<string, SpikeAnalysisRecord>()
  for (const r of all) {
    map.set(`${r.matter_unique_id}__${r.week_start}`, r)
  }
  return map
}

export interface ActivityPatternsRollup {
  total_entries: number
  time_entries: number
  expense_entries: number
  billable_hours: number
  nonbillable_hours: number
  flat_rate_count: number
  hourly_count: number
  total_billable_amount: number
  top_users: Array<{ user_name: string; amount: number }>
}

export async function fetchActivityPatternsRollup(
  supabase: SupabaseClient,
  filters: FilterState,
): Promise<ActivityPatternsRollup> {
  let matterIds: string[] | null = null
  if (
    filters.status.length > 0 ||
    filters.caseType.length > 0 ||
    filters.county.length > 0 ||
    filters.attorney.length > 0
  ) {
    const matters = await fetchMatters(supabase, filters)
    matterIds = matters.map((m) => m.unique_id)
    if (matterIds.length === 0) {
      return {
        total_entries: 0,
        time_entries: 0,
        expense_entries: 0,
        billable_hours: 0,
        nonbillable_hours: 0,
        flat_rate_count: 0,
        hourly_count: 0,
        total_billable_amount: 0,
        top_users: [],
      }
    }
  }
  const { data, error } = await supabase.rpc("activity_patterns_rollup", {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    matter_ids: matterIds,
  })
  if (error) throw error
  return data as ActivityPatternsRollup
}

export async function fetchFilterOptions(supabase: SupabaseClient) {
  const allMatters: Array<{ status: string; case_type: string; county: string; responsible_attorney: string; mapped_category: string | null }> = []
  const PAGE = 2000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from("clio_matters")
      .select("status, case_type, county, responsible_attorney, mapped_category")
      .range(offset, offset + PAGE - 1)
    if (!data || data.length === 0) break
    allMatters.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  const statuses = [...new Set(allMatters.map((m) => m.status).filter(Boolean))].sort()

  // Use mapped_category for case type filter; add "Not Mapped" for nulls
  const mappedCategories = [...new Set(allMatters.map((m) => m.mapped_category).filter(Boolean) as string[])].sort()
  const hasUnmapped = allMatters.some((m) => !m.mapped_category)
  const caseTypes = hasUnmapped ? [...mappedCategories, "Not Mapped"] : mappedCategories

  const counties = [...new Set(allMatters.map((m) => m.county).filter(Boolean))].sort()
  const attorneys = [
    ...new Set(allMatters.map((m) => m.responsible_attorney).filter(Boolean)),
  ].sort()

  return { statuses, caseTypes, counties, attorneys }
}
