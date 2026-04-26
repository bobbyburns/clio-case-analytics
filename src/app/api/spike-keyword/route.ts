import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim()
  if (q.length < 3) {
    return NextResponse.json({ matches: [] })
  }
  const floorRaw = req.nextUrl.searchParams.get("floor")
  const floor = floorRaw && Number.isFinite(Number(floorRaw)) ? Number(floorRaw) : 0

  // PostgREST caps RPC responses at the project max-rows (default 1000), so we
  // page through with .range() until we get a short page. Same trick used in
  // src/lib/queries.ts pagedRpc for the rollup fetchers.
  const all: Array<{ matter_unique_id: string; week_start: string }> = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .rpc("weeks_with_activity_keyword", { p_keyword: q, p_floor: floor })
      .range(offset, offset + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data as Array<{ matter_unique_id: string; week_start: string }>) ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
    offset += PAGE
  }
  const matches = all.map((r) => `${r.matter_unique_id}__${r.week_start}`)
  return NextResponse.json({ matches })
}
