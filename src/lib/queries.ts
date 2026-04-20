import type { SupabaseClient } from "@supabase/supabase-js"
import type { FilterState, Matter, Activity } from "@/lib/types"

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
  }
}

function buildMatterQuery(supabase: SupabaseClient, filters: FilterState) {
  let q = supabase.from("clio_matters").select("*")
  if (filters.status.length > 0) q = q.in("status", filters.status)
  if (filters.caseType.length > 0) q = q.in("case_type", filters.caseType)
  if (filters.county.length > 0) q = q.in("county", filters.county)
  if (filters.attorney.length > 0) q = q.in("responsible_attorney", filters.attorney)
  if (filters.dateFrom) q = q.gte("open_date", filters.dateFrom)
  if (filters.dateTo) q = q.lte("open_date", filters.dateTo)
  return q
}

export async function fetchMatters(
  supabase: SupabaseClient,
  filters: FilterState
): Promise<Matter[]> {
  const all: Matter[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await buildMatterQuery(supabase, filters)
      .order("open_date", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Matter[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
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

export async function fetchFilterOptions(supabase: SupabaseClient) {
  const allMatters: Array<{ status: string; case_type: string; county: string; responsible_attorney: string }> = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from("clio_matters")
      .select("status, case_type, county, responsible_attorney")
      .range(offset, offset + PAGE - 1)
    if (!data || data.length === 0) break
    allMatters.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  const statuses = [...new Set(allMatters.map((m) => m.status).filter(Boolean))].sort()
  const caseTypes = [...new Set(allMatters.map((m) => m.case_type).filter(Boolean))].sort()
  const counties = [...new Set(allMatters.map((m) => m.county).filter(Boolean))].sort()
  const attorneys = [
    ...new Set(allMatters.map((m) => m.responsible_attorney).filter(Boolean)),
  ].sort()

  return { statuses, caseTypes, counties, attorneys }
}
