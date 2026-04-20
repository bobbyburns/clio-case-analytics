import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const matterId = req.nextUrl.searchParams.get("matterId")
  if (!matterId) {
    return NextResponse.json({ error: "matterId required" }, { status: 400 })
  }

  // Paginate to get all activities for this matter
  const all: Array<Record<string, unknown>> = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from("clio_activities")
      .select("*")
      .eq("matter_unique_id", matterId)
      .order("activity_date", { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  return NextResponse.json({ activities: all })
}
