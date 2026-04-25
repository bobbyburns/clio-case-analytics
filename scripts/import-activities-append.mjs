/**
 * APPEND new activities to Supabase without clearing existing data.
 * Dedupes against existing clio_ids so re-running is safe.
 * After insert, recomputes matter aggregates only for matters that received new activities.
 *
 * Usage: node scripts/import-activities-append.mjs <activities.csv>
 */
import { createClient } from "@supabase/supabase-js"
import { createReadStream } from "fs"
import { parse } from "csv-parse"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const file = process.argv[2]
if (!file) {
  console.error("Usage: node scripts/import-activities-append.mjs <activities.csv>")
  process.exit(1)
}

function parseDate(str) {
  if (!str) return null
  const parts = str.trim().split(" ")[0].split("/")
  if (parts.length !== 3) return null
  const [m, d, y] = parts
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
}
function parseNum(str) {
  if (!str || str.trim() === "") return 0
  return parseFloat(str.replace(/[,$]/g, "")) || 0
}
function parseBool(str) {
  return str?.toLowerCase() === "true"
}

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = []
    createReadStream(filePath, { encoding: "utf-8" })
      .pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject)
  })
}

async function main() {
  // 1. Load existing clio_ids into a Set (dedupe guard)
  console.log("Loading existing clio_ids for dedup check...")
  const existingIds = new Set()
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from("clio_activities")
      .select("clio_id")
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) if (r.clio_id) existingIds.add(r.clio_id)
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`  Found ${existingIds.size} existing activities already in DB.`)

  // 2. Load matter lookup
  console.log("Loading matter lookup (display_number -> unique_id)...")
  const displayToUniqueId = new Map()
  offset = 0
  while (true) {
    const { data, error } = await supabase
      .from("clio_matters")
      .select("unique_id, display_number")
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const m of data) {
      if (m.display_number) displayToUniqueId.set(m.display_number, m.unique_id)
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`  Loaded ${displayToUniqueId.size} matters.`)

  // 3. Parse CSV
  console.log(`Parsing ${file}...`)
  const rows = await parseCSV(file)
  console.log(`  Parsed ${rows.length} rows.`)

  // 4. Map, dedupe, filter
  const newActivities = []
  let skippedNoMatter = 0
  let skippedDup = 0
  let matterMissMap = new Map() // display_number -> count
  for (const r of rows) {
    const clioId = r["ID"] || null
    if (clioId && existingIds.has(clioId)) {
      skippedDup++
      continue
    }
    // Strip the " - (Description)" suffix from matter number since our matter
    // table's display_number can contain it too. Try exact match first, then strip.
    const rawDisplay = r["Matter number"] || ""
    let uid = displayToUniqueId.get(rawDisplay)
    if (!uid) {
      // Try fuzzier match: does any display_number start with the raw number?
      // (e.g., CSV has "02667-Oscar-Vanderhorst/DOM" but DB has it with the suffix)
      for (const [disp, u] of displayToUniqueId) {
        if (disp.startsWith(rawDisplay) || rawDisplay.startsWith(disp)) {
          uid = u
          break
        }
      }
    }
    if (!uid) {
      skippedNoMatter++
      matterMissMap.set(rawDisplay, (matterMissMap.get(rawDisplay) ?? 0) + 1)
      continue
    }
    newActivities.push({
      clio_id: clioId,
      type: r["Type"] || "TimeEntry",
      activity_date: parseDate(r["Date"]),
      hours: parseNum(r["Hours"]),
      description: r["Description"] || null,
      matter_display_number: rawDisplay,
      matter_unique_id: uid,
      flat_rate: parseBool(r["Flat rate"]),
      rate: parseNum(r["Rate ($)"]),
      billable_amount: parseNum(r["Billable ($)"]),
      nonbillable_amount: parseNum(r["Non-billable ($)"]),
      user_name: r["User"] || null,
      bill_state: r["Bill state"] || null,
      bill_number: r["Bill number"] || null,
      expense_category: r["Expense category"] || null,
    })
  }
  console.log(
    `  ${newActivities.length} new to insert | ${skippedDup} already present | ${skippedNoMatter} had no matching matter`,
  )
  if (matterMissMap.size > 0 && matterMissMap.size <= 20) {
    console.log("  Missing matter display_numbers:")
    for (const [k, v] of matterMissMap) console.log(`    ${v}x ${k}`)
  } else if (matterMissMap.size > 20) {
    console.log(`  ${matterMissMap.size} distinct matter display_numbers missing (too many to list).`)
  }

  if (newActivities.length === 0) {
    console.log("Nothing new to insert. Done.")
    return
  }

  // 5. Insert in batches
  console.log(`Inserting ${newActivities.length} new activities in batches of 500...`)
  let inserted = 0
  for (let i = 0; i < newActivities.length; i += 500) {
    const batch = newActivities.slice(i, i + 500)
    const { error } = await supabase.from("clio_activities").insert(batch)
    if (error) {
      console.error(`  Error at batch starting ${i}: ${error.message}`)
      continue
    }
    inserted += batch.length
    if (inserted % 2500 === 0 || inserted === newActivities.length) {
      console.log(`  Inserted ${inserted}/${newActivities.length}`)
    }
  }

  // 6. Recompute aggregates ONLY for matters with new activities
  const affectedMatterIds = Array.from(new Set(newActivities.map((a) => a.matter_unique_id)))
  console.log(`\nRecomputing aggregates for ${affectedMatterIds.length} affected matters...`)
  let updated = 0
  for (let i = 0; i < affectedMatterIds.length; i++) {
    const uid = affectedMatterIds[i]
    const { data: agg } = await supabase
      .from("clio_activities")
      .select("billable_amount, nonbillable_amount, hours, type")
      .eq("matter_unique_id", uid)
    if (!agg) continue
    const totals = agg.reduce(
      (acc, a) => {
        acc.total_billable += a.billable_amount || 0
        acc.total_nonbillable += a.nonbillable_amount || 0
        acc.total_hours += a.hours || 0
        if (a.type === "ExpenseEntry") acc.total_expenses += a.billable_amount || 0
        acc.activity_count += 1
        return acc
      },
      { total_billable: 0, total_nonbillable: 0, total_hours: 0, total_expenses: 0, activity_count: 0 },
    )
    const { error } = await supabase.from("clio_matters").update(totals).eq("unique_id", uid)
    if (!error) updated++
    if ((i + 1) % 50 === 0 || i + 1 === affectedMatterIds.length) {
      console.log(`  Refreshed ${i + 1}/${affectedMatterIds.length} (${updated} updated)`)
    }
  }
  console.log("Refreshing materialized rollups...")
  const { error: refreshErr } = await supabase.rpc("refresh_rollups")
  if (refreshErr) console.warn("  refresh_rollups failed:", refreshErr.message)

  console.log(`\n✅ Done. Inserted ${inserted} activities, refreshed ${updated} matter aggregates.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
