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

  const { data, error } = await supabase.rpc("weeks_with_activity_keyword", {
    p_keyword: q,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const matches = ((data as Array<{ matter_unique_id: string; week_start: string }>) ?? [])
    .map((r) => `${r.matter_unique_id}__${r.week_start}`)
  return NextResponse.json({ matches })
}
