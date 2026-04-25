/**
 * Import activities CSV into Supabase (activities only, assumes matters already loaded).
 * Usage: node scripts/import-activities-only.mjs <activities.csv>
 */
import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "fs";
import { parse } from "csv-parse";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const file = process.argv[2];

function parseDate(str) {
  if (!str) return null;
  const parts = str.trim().split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function parseNum(str) {
  if (!str || str.trim() === "") return 0;
  return parseFloat(str.replace(/[,$]/g, "")) || 0;
}
function parseBool(str) { return str?.toLowerCase() === "true"; }

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath, { encoding: "utf-8" })
      .pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function main() {
  // First clear existing activities
  console.log("Clearing existing activities...");
  // Delete in batches to avoid timeout
  let deleted = 0;
  while (true) {
    const { data, error } = await supabase
      .from("clio_activities")
      .select("id")
      .limit(5000);
    if (error || !data || data.length === 0) break;
    const ids = data.map(r => r.id);
    await supabase.from("clio_activities").delete().in("id", ids);
    deleted += ids.length;
    console.log(`  Deleted ${deleted}...`);
  }
  console.log(`  Cleared ${deleted} existing activities.`);

  // Load matter lookup
  console.log("Loading matter lookup...");
  const displayToUniqueId = new Map();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from("clio_matters")
      .select("unique_id, display_number")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const m of data) {
      if (m.display_number) displayToUniqueId.set(m.display_number, m.unique_id);
    }
    offset += data.length;
  }
  console.log(`  Loaded ${displayToUniqueId.size} matters.`);

  // Parse CSV
  console.log(`Parsing ${file}...`);
  const rows = await parseCSV(file);
  console.log(`  Parsed ${rows.length} rows.`);

  // Map and filter
  const activities = [];
  let skipped = 0;
  for (const r of rows) {
    const displayNum = r["Matter number"] || "";
    const uid = displayToUniqueId.get(displayNum);
    if (!uid) { skipped++; continue; }
    activities.push({
      clio_id: r["ID"] || null,
      type: r["Type"] || "TimeEntry",
      activity_date: parseDate(r["Date"]),
      hours: parseNum(r["Hours"]),
      description: r["Description"] || null,
      matter_display_number: displayNum,
      matter_unique_id: uid,
      flat_rate: parseBool(r["Flat rate"]),
      rate: parseNum(r["Rate ($)"]),
      billable_amount: parseNum(r["Billable ($)"]),
      nonbillable_amount: parseNum(r["Non-billable ($)"]),
      user_name: r["User"] || null,
      bill_state: r["Bill state"] || null,
      bill_number: r["Bill number"] || null,
      expense_category: r["Expense category"] || null,
    });
  }
  console.log(`  ${activities.length} linked, ${skipped} skipped (no matter).`);

  // Insert in batches
  const BATCH = 500;
  for (let i = 0; i < activities.length; i += BATCH) {
    const batch = activities.slice(i, i + BATCH);
    const { error } = await supabase.from("clio_activities").insert(batch);
    if (error) {
      console.error(`  Error at ${i}: ${error.message}`);
    }
    if ((i + BATCH) % 5000 === 0 || i + BATCH >= activities.length) {
      console.log(`  Inserted ${Math.min(i + BATCH, activities.length)}/${activities.length}`);
    }
  }

  // Update matter aggregates
  console.log("\nUpdating matter aggregates...");
  const { data: matterIds } = await supabase
    .from("clio_matters")
    .select("unique_id")
    .limit(10000);

  let updated = 0;
  for (let i = 0; i < matterIds.length; i++) {
    const uid = matterIds[i].unique_id;
    const { data: agg } = await supabase
      .from("clio_activities")
      .select("billable_amount, nonbillable_amount, hours, type")
      .eq("matter_unique_id", uid);

    if (agg && agg.length > 0) {
      const totals = agg.reduce((acc, a) => {
        acc.total_billable += a.billable_amount || 0;
        acc.total_nonbillable += a.nonbillable_amount || 0;
        acc.total_hours += a.hours || 0;
        if (a.type === "ExpenseEntry") acc.total_expenses += a.billable_amount || 0;
        acc.activity_count += 1;
        return acc;
      }, { total_billable: 0, total_nonbillable: 0, total_hours: 0, total_expenses: 0, activity_count: 0 });

      await supabase.from("clio_matters").update(totals).eq("unique_id", uid);
      updated++;
    }
    if ((i + 1) % 200 === 0) {
      console.log(`  Aggregated ${i + 1}/${matterIds.length} matters (${updated} with data)`);
    }
  }
  console.log(`  Done. Updated ${updated} matters.`);

  console.log("\nRefreshing materialized rollups...");
  const { error: refreshErr } = await supabase.rpc("refresh_rollups");
  if (refreshErr) console.warn("  refresh_rollups failed:", refreshErr.message);

  console.log("\n✅ Import complete!");
}

main().catch(err => { console.error(err); process.exit(1); });
