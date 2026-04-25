/**
 * Import Clio CSV exports into Supabase.
 * Usage: node scripts/import-data.mjs <matters.csv> <activities.csv>
 */
import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "fs";
import { parse } from "csv-parse";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars. Source .env.local first.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const mattersFile = process.argv[2];
const activitiesFile = process.argv[3];

if (!mattersFile || !activitiesFile) {
  console.error("Usage: node scripts/import-data.mjs <matters.csv> <activities.csv>");
  process.exit(1);
}

function parseDate(str) {
  if (!str) return null;
  // Handle "MM/DD/YYYY" or "MM/DD/YYYY H:MM AM/PM TZ"
  const parts = str.trim().split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  if (isNaN(Date.parse(iso))) return null;
  return iso;
}

function parseNum(str) {
  if (!str || str.trim() === "") return 0;
  const n = parseFloat(str.replace(/[,$]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseBool(str) {
  return str?.toLowerCase() === "true";
}

function extractCaseType(displayNumber, description) {
  // Extract case type from display number: "00001-Name/CaseType - (Details)"
  if (!displayNumber) return description || null;
  const slash = displayNumber.indexOf("/");
  if (slash === -1) return description || null;
  const suffix = displayNumber.substring(slash + 1);
  // Remove parenthetical details
  const dash = suffix.indexOf(" - ");
  return (dash !== -1 ? suffix.substring(0, dash) : suffix).trim();
}

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath, { encoding: "utf-8" })
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          bom: true,
          relax_column_count: true,
        })
      )
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function importMatters() {
  console.log(`\nParsing matters from: ${mattersFile}`);
  const rows = await parseCSV(mattersFile);
  console.log(`  Parsed ${rows.length} matter rows`);

  const matters = rows.map((r) => {
    const openDate = parseDate(r["Open Date"]);
    const closeDate = parseDate(r["Close Date"]);
    let durationDays = null;
    if (openDate && closeDate) {
      durationDays = Math.round(
        (new Date(closeDate) - new Date(openDate)) / (1000 * 60 * 60 * 24)
      );
    }
    return {
      unique_id: r["Unique ID"],
      display_number: r["Display Number"],
      description: r["Description"],
      status: r["Status"] || "Open",
      open_date: openDate,
      close_date: closeDate,
      duration_days: durationDays,
      county: r["County"] || null,
      practice_area: r["Practice Area"] || null,
      case_type: extractCaseType(r["Display Number"], r["Description"]),
      number_of_children: r["Number of Children"]
        ? parseInt(r["Number of Children"]) || null
        : null,
      date_of_marriage: parseDate(r["Date of Marriage"]),
      responsible_attorney: r["Responsible Attorney"] || null,
      originating_attorney: r["Originating Attorney"] || null,
      opposing_counsel: r["Opposing Counsel's Full Name"] || null,
      retainer_type: r["Retainer Type"] || null,
      scope_of_representation: r["Scope of Representation"] || null,
      case_number: r["Case Number"] || null,
      clients: r["Clients"] || null,
      billable: parseBool(r["Billable"]),
    };
  });

  // Batch upsert in chunks of 500
  const BATCH = 500;
  for (let i = 0; i < matters.length; i += BATCH) {
    const batch = matters.slice(i, i + BATCH);
    const { error } = await supabase
      .from("clio_matters")
      .upsert(batch, { onConflict: "unique_id" });
    if (error) {
      console.error(`  Error at batch ${i}: ${error.message}`);
      console.error(error);
    } else {
      console.log(`  Upserted matters ${i + 1}–${i + batch.length}`);
    }
  }

  return matters;
}

async function importActivities(mattersMap) {
  console.log(`\nParsing activities from: ${activitiesFile}`);
  const rows = await parseCSV(activitiesFile);
  console.log(`  Parsed ${rows.length} activity rows`);

  // Build lookup from display_number to unique_id
  const displayToUniqueId = new Map();
  for (const m of mattersMap) {
    if (m.display_number) {
      displayToUniqueId.set(m.display_number, m.unique_id);
    }
  }

  const activities = rows.map((r) => {
    const displayNum = r["Matter number"] || "";
    return {
      clio_id: r["ID"] || null,
      type: r["Type"] || "TimeEntry",
      activity_date: parseDate(r["Date"]),
      hours: parseNum(r["Hours"]),
      description: r["Description"] || null,
      matter_display_number: displayNum,
      matter_unique_id: displayToUniqueId.get(displayNum) || null,
      flat_rate: parseBool(r["Flat rate"]),
      rate: parseNum(r["Rate ($)"]),
      billable_amount: parseNum(r["Billable ($)"]),
      nonbillable_amount: parseNum(r["Non-billable ($)"]),
      user_name: r["User"] || null,
      bill_state: r["Bill state"] || null,
      bill_number: r["Bill number"] || null,
      expense_category: r["Expense category"] || null,
    };
  });

  // Filter out activities with no matter link
  const linked = activities.filter((a) => a.matter_unique_id);
  const unlinked = activities.length - linked.length;
  if (unlinked > 0) {
    console.log(`  Warning: ${unlinked} activities have no matching matter`);
  }

  // Batch insert in chunks of 1000
  const BATCH = 1000;
  for (let i = 0; i < linked.length; i += BATCH) {
    const batch = linked.slice(i, i + BATCH);
    const { error } = await supabase.from("clio_activities").insert(batch);
    if (error) {
      console.error(`  Error at batch ${i}: ${error.message}`);
    } else {
      console.log(`  Inserted activities ${i + 1}–${i + batch.length}`);
    }
  }

  return linked;
}

async function updateMatterAggregates() {
  console.log("\nComputing matter cost aggregates...");

  // Fetch all aggregates from activities
  const { data, error } = await supabase.rpc("aggregate_matter_costs");
  if (error) {
    // If RPC doesn't exist, do it in batches via REST
    console.log("  RPC not available, computing via queries...");

    // Get all unique matter IDs
    const { data: matters } = await supabase
      .from("clio_matters")
      .select("unique_id")
      .limit(10000);

    let updated = 0;
    const BATCH = 50;
    for (let i = 0; i < matters.length; i += BATCH) {
      const batch = matters.slice(i, i + BATCH);
      for (const m of batch) {
        const { data: agg } = await supabase
          .from("clio_activities")
          .select("billable_amount, nonbillable_amount, hours, type")
          .eq("matter_unique_id", m.unique_id);

        if (agg && agg.length > 0) {
          const totals = agg.reduce(
            (acc, a) => {
              acc.total_billable += a.billable_amount || 0;
              acc.total_nonbillable += a.nonbillable_amount || 0;
              acc.total_hours += a.hours || 0;
              if (a.type === "ExpenseEntry") acc.total_expenses += a.billable_amount || 0;
              acc.activity_count += 1;
              return acc;
            },
            { total_billable: 0, total_nonbillable: 0, total_hours: 0, total_expenses: 0, activity_count: 0 }
          );

          await supabase
            .from("clio_matters")
            .update(totals)
            .eq("unique_id", m.unique_id);
          updated++;
        }
      }
      if ((i + BATCH) % 200 === 0 || i + BATCH >= matters.length) {
        console.log(`  Updated ${Math.min(i + BATCH, matters.length)}/${matters.length} matters`);
      }
    }
    console.log(`  Done. Updated ${updated} matters with cost data.`);
  } else {
    console.log("  Aggregates computed via RPC.");
  }
}

async function main() {
  console.log("=== Clio Data Import ===");

  const matters = await importMatters();
  await importActivities(matters);
  await updateMatterAggregates();

  console.log("\nRefreshing materialized rollups...");
  const { error: refreshErr } = await supabase.rpc("refresh_rollups");
  if (refreshErr) console.warn("  refresh_rollups failed:", refreshErr.message);
  else console.log("  Rollups refreshed.");

  console.log("\n✅ Import complete!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
