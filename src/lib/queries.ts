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

export async function fetchMatters(
  supabase: SupabaseClient,
  filters: FilterState
): Promise<Matter[]> {
  let query = supabase.from("clio_matters").select("*")

  if (filters.status.length > 0) {
    query = query.in("status", filters.status)
  }
  if (filters.caseType.length > 0) {
    query = query.in("case_type", filters.caseType)
  }
  if (filters.county.length > 0) {
    query = query.in("county", filters.county)
  }
  if (filters.attorney.length > 0) {
    query = query.in("responsible_attorney", filters.attorney)
  }
  if (filters.dateFrom) {
    query = query.gte("open_date", filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte("open_date", filters.dateTo)
  }

  const { data, error } = await query.order("open_date", { ascending: false })
  if (error) throw error
  return (data ?? []) as Matter[]
}

export async function fetchActivities(
  supabase: SupabaseClient,
  filters: FilterState
): Promise<Activity[]> {
  // If we have matter-level filters, first get the matching matter unique_ids
  let matterIds: number[] | null = null
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

  let query = supabase.from("clio_activities").select("*")

  if (matterIds) {
    query = query.in("matter_unique_id", matterIds)
  }
  if (filters.dateFrom) {
    query = query.gte("activity_date", filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte("activity_date", filters.dateTo)
  }

  const { data, error } = await query.order("activity_date", { ascending: false })
  if (error) throw error
  return (data ?? []) as Activity[]
}

export async function fetchFilterOptions(supabase: SupabaseClient) {
  const { data: matters } = await supabase
    .from("clio_matters")
    .select("status, case_type, county, responsible_attorney")

  const statuses = [...new Set((matters ?? []).map((m) => m.status).filter(Boolean))].sort()
  const caseTypes = [...new Set((matters ?? []).map((m) => m.case_type).filter(Boolean))].sort()
  const counties = [...new Set((matters ?? []).map((m) => m.county).filter(Boolean))].sort()
  const attorneys = [
    ...new Set((matters ?? []).map((m) => m.responsible_attorney).filter(Boolean)),
  ].sort()

  return { statuses, caseTypes, counties, attorneys }
}
