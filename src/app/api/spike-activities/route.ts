import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchSpikeActivities } from "@/lib/queries"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const matterId = req.nextUrl.searchParams.get("matterId")
  const weekStart = req.nextUrl.searchParams.get("weekStart")
  if (!matterId || !weekStart) {
    return NextResponse.json(
      { error: "matterId and weekStart required" },
      { status: 400 },
    )
  }

  try {
    const activities = await fetchSpikeActivities(supabase, matterId, weekStart)
    return NextResponse.json({ activities })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
