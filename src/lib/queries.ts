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

function buildMatterQuery(supabase: SupabaseClient, filters: FilterState, includeDisregarded = false) {
  let q = supabase.from("clio_matters").select("*")
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
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await buildMatterQuery(supabase, filters, includeDisregarded)
      .order("open_date", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Matter[]))
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
  const PAGE = 1000
  let offset = 0
  while (true) {
    let q = supabase.from("clio_activities").select("*")
    if (matterIds) q = q.in("matter_unique_id", matterIds)
    if (filters.dateFrom) q = q.gte("activity_date", filters.dateFrom)
    if (filters.dateTo) q = q.lte("activity_date", filters.dateTo)
    const { data, error } = await q
      .order("activity_date", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Activity[]))
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

  const ID_CHUNK = 100
  const PAGE = 1000
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

export async function fetchFilterOptions(supabase: SupabaseClient) {
  const allMatters: Array<{ status: string; case_type: string; county: string; responsible_attorney: string; mapped_category: string | null }> = []
  const PAGE = 1000
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
