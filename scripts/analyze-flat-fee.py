"""
Analyze closed divorce cases for flat-fee pricing structure.
Pulls from Supabase, analyzes cost clusters, characteristics, outliers.
"""
import json, os, urllib.request, statistics, sys

SRK = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SRK:
    sys.exit("Set SUPABASE_SERVICE_ROLE_KEY in your environment before running this script.")
BASE = "https://fewvzqkypfwzakpyxcup.supabase.co/rest/v1"

def fetch_all(table, params=""):
    all_data = []
    offset = 0
    while True:
        url = f"{BASE}/{table}?{params}&limit=1000&offset={offset}"
        req = urllib.request.Request(url, headers={"apikey": SRK, "Authorization": f"Bearer {SRK}"})
        with urllib.request.urlopen(req) as resp:
            data = json.load(resp)
        if not data:
            break
        all_data.extend(data)
        if len(data) < 1000:
            break
        offset += 1000
    return all_data

def pct(arr, p):
    s = sorted(arr)
    idx = int(len(s) * p / 100)
    return s[min(idx, len(s)-1)]

# 1. Get all non-disregarded closed divorce cases
print("Fetching data...", file=sys.stderr)
matters = fetch_all("clio_matters",
    "mapped_category=eq.Divorce&status=eq.Closed&or=(disregarded.is.null,disregarded.eq.false)"
    "&select=unique_id,display_number,total_billable,total_hours,duration_days,"
    "number_of_children,county,has_opposing_counsel,responsible_attorney,"
    "case_type,activity_count,open_date,close_date")

cases = [m for m in matters if (m.get("total_billable") or 0) > 0]
costs = sorted([m["total_billable"] for m in cases])

print(f"\n{'='*70}")
print(f"FLAT FEE ANALYSIS — {len(cases)} CLOSED DIVORCE CASES")
print(f"{'='*70}")

print(f"\n--- OVERALL STATS ---")
print(f"  Median:  ${statistics.median(costs):>10,.0f}")
print(f"  Mean:    ${statistics.mean(costs):>10,.0f}")
print(f"  Std Dev: ${statistics.stdev(costs):>10,.0f}")
for p_val in [10, 25, 50, 75, 90, 95]:
    print(f"  P{p_val}:     ${pct(costs, p_val):>10,.0f}")

# 2. By characteristics
print(f"\n--- COST BY OPPOSING COUNSEL ---")
with_oc = [m["total_billable"] for m in cases if m.get("has_opposing_counsel")]
without_oc = [m["total_billable"] for m in cases if not m.get("has_opposing_counsel")]
if with_oc:
    print(f"  WITH OC:    n={len(with_oc):4d}  median=${statistics.median(with_oc):>8,.0f}  mean=${statistics.mean(with_oc):>8,.0f}  P90=${pct(with_oc, 90):>8,.0f}")
if without_oc:
    print(f"  WITHOUT OC: n={len(without_oc):4d}  median=${statistics.median(without_oc):>8,.0f}  mean=${statistics.mean(without_oc):>8,.0f}  P90=${pct(without_oc, 90):>8,.0f}")

print(f"\n--- COST BY NUMBER OF CHILDREN ---")
for nc in [0, 1, 2]:
    subset = [m["total_billable"] for m in cases if (m.get("number_of_children") or 0) == nc]
    if len(subset) >= 3:
        print(f"  {nc} children: n={len(subset):4d}  median=${statistics.median(subset):>8,.0f}  mean=${statistics.mean(subset):>8,.0f}  P90=${pct(subset, 90):>8,.0f}")
subset3 = [m["total_billable"] for m in cases if (m.get("number_of_children") or 0) >= 3]
if len(subset3) >= 3:
    print(f"  3+ children: n={len(subset3):4d}  median=${statistics.median(subset3):>8,.0f}  mean=${statistics.mean(subset3):>8,.0f}  P90=${pct(subset3, 90):>8,.0f}")
unknown_kids = [m["total_billable"] for m in cases if m.get("number_of_children") is None]
if unknown_kids:
    print(f"  Unknown:   n={len(unknown_kids):4d}  median=${statistics.median(unknown_kids):>8,.0f}")

print(f"\n--- COST BY DURATION ---")
for label, lo, hi in [("< 3 mo", 0, 90), ("3-6 mo", 90, 180), ("6-12 mo", 180, 365), ("12-18 mo", 365, 548), ("18-24 mo", 548, 730), ("24+ mo", 730, 99999)]:
    subset = [m["total_billable"] for m in cases if m.get("duration_days") and lo <= m["duration_days"] < hi]
    if len(subset) >= 3:
        print(f"  {label:10s} n={len(subset):4d}  median=${statistics.median(subset):>8,.0f}  mean=${statistics.mean(subset):>8,.0f}  P90=${pct(subset, 90):>8,.0f}")

print(f"\n--- TOP COUNTIES ---")
county_data = {}
for m in cases:
    c = m.get("county") or "Unknown"
    county_data.setdefault(c, []).append(m["total_billable"])
for c, vals in sorted(county_data.items(), key=lambda x: -len(x[1]))[:10]:
    if len(vals) >= 5:
        print(f"  {c:15s} n={len(vals):4d}  median=${statistics.median(vals):>8,.0f}  mean=${statistics.mean(vals):>8,.0f}")

# 3. Natural tiers
tiers = [
    (0, 2000, "Under $2K"),
    (2000, 4000, "$2K-$4K"),
    (4000, 7000, "$4K-$7K"),
    (7000, 12000, "$7K-$12K"),
    (12000, 25000, "$12K-$25K"),
    (25000, 999999, "$25K+"),
]

print(f"\n{'='*70}")
print(f"NATURAL COST TIERS")
print(f"{'='*70}")
for lo, hi, label in tiers:
    subset = [c for c in costs if lo <= c < hi]
    if subset:
        p = len(subset) / len(costs) * 100
        cum = sum(1 for c in costs if c < hi) / len(costs) * 100
        # Get characteristics of cases in this tier
        tier_cases = [m for m in cases if lo <= m["total_billable"] < hi]
        oc_pct = sum(1 for m in tier_cases if m.get("has_opposing_counsel")) / len(tier_cases) * 100
        dur_vals = [m["duration_days"] for m in tier_cases if m.get("duration_days")]
        avg_dur = statistics.mean(dur_vals) / 30.4 if dur_vals else 0
        hours_vals = [m["total_hours"] for m in tier_cases if m.get("total_hours") and m["total_hours"] > 0]
        avg_hrs = statistics.mean(hours_vals) if hours_vals else 0
        med_hrs = statistics.median(hours_vals) if hours_vals else 0
        acts = [m["activity_count"] for m in tier_cases if m.get("activity_count")]
        avg_acts = statistics.mean(acts) if acts else 0

        print(f"\n  {label:15s}  {len(subset):4d} cases ({p:5.1f}%)  cumulative: {cum:5.1f}%")
        print(f"    Cost:      median=${statistics.median(subset):>7,.0f}  mean=${statistics.mean(subset):>7,.0f}  range=${min(subset):>6,.0f}-${max(subset):>6,.0f}")
        print(f"    Hours:     median={med_hrs:>5.1f}h  mean={avg_hrs:>5.1f}h")
        print(f"    Duration:  avg={avg_dur:>4.1f} months")
        print(f"    Activities: avg={avg_acts:>4.0f}")
        print(f"    Has OC:    {oc_pct:.0f}%")

# 4. Outlier deep dive
print(f"\n{'='*70}")
print(f"OUTLIER ANALYSIS — WHAT MAKES CASES EXPENSIVE?")
print(f"{'='*70}")

p90_val = pct(costs, 90)
p75_val = pct(costs, 75)
outliers = [m for m in cases if m["total_billable"] >= p90_val]
normal = [m for m in cases if m["total_billable"] < p75_val]

print(f"\nComparing top 10% (>=${pct(costs,90):,.0f}) vs bottom 75% (<${p75_val:,.0f}):")
print(f"  {'Metric':<25s} {'Top 10%':>12s}  {'Bottom 75%':>12s}")
print(f"  {'-'*25} {'-'*12}  {'-'*12}")

# Opposing counsel rate
o_out = sum(1 for m in outliers if m.get("has_opposing_counsel")) / len(outliers) * 100
o_norm = sum(1 for m in normal if m.get("has_opposing_counsel")) / len(normal) * 100
print(f"  {'Has opposing counsel':<25s} {o_out:>11.0f}%  {o_norm:>11.0f}%")

# Duration
d_out = [m["duration_days"]/30.4 for m in outliers if m.get("duration_days")]
d_norm = [m["duration_days"]/30.4 for m in normal if m.get("duration_days")]
if d_out and d_norm:
    print(f"  {'Avg duration (months)':<25s} {statistics.mean(d_out):>11.1f}  {statistics.mean(d_norm):>11.1f}")

# Hours
h_out = [m["total_hours"] for m in outliers if m.get("total_hours") and m["total_hours"] > 0]
h_norm = [m["total_hours"] for m in normal if m.get("total_hours") and m["total_hours"] > 0]
if h_out and h_norm:
    print(f"  {'Avg hours':<25s} {statistics.mean(h_out):>11.1f}  {statistics.mean(h_norm):>11.1f}")

# Activities
a_out = [m["activity_count"] for m in outliers if m.get("activity_count")]
a_norm = [m["activity_count"] for m in normal if m.get("activity_count")]
if a_out and a_norm:
    print(f"  {'Avg activities':<25s} {statistics.mean(a_out):>11.0f}  {statistics.mean(a_norm):>11.0f}")

print(f"\nTop 15 most expensive cases:")
for m in sorted(outliers, key=lambda x: -x["total_billable"])[:15]:
    dur = f"{m['duration_days']/30.4:.0f}mo" if m.get("duration_days") else "?mo"
    oc = "OC" if m.get("has_opposing_counsel") else "no-OC"
    kids = m.get("number_of_children")
    kids_s = f"{kids}kid" if kids is not None else "?kid"
    hrs = f"{m.get('total_hours', 0):.0f}h"
    print(f"  ${m['total_billable']:>10,.0f}  {dur:>6s}  {hrs:>5s}  {oc:6s}  {kids_s:5s}  {m['display_number'][:45]}")

# 5. Stage analysis — look at activity timing patterns
print(f"\n{'='*70}")
print(f"ACTIVITY TIMING — WHEN DO COSTS HIT?")
print(f"{'='*70}")

# Sample some cases and look at activity distribution over case lifecycle
sample_ids = [m["unique_id"] for m in sorted(cases, key=lambda x: -x["total_billable"])[:100]]
# Fetch activities for these cases
print("Fetching activities for top 100 cases...", file=sys.stderr)
sample_activities = []
for uid in sample_ids[:50]:  # top 50 to keep it manageable
    acts = fetch_all("clio_activities", f"matter_unique_id=eq.{uid}&select=activity_date,billable_amount,hours,type")
    for a in acts:
        a["_matter_uid"] = uid
    sample_activities.extend(acts)

print(f"  Fetched {len(sample_activities)} activities for top 50 cases")

# For each case, compute cumulative cost at 25%, 50%, 75%, 100% of duration
stage_data = {"first_quarter": [], "first_half": [], "third_quarter": [], "final_quarter": []}
for uid in sample_ids[:50]:
    m = next((m for m in cases if m["unique_id"] == uid), None)
    if not m or not m.get("duration_days") or m["duration_days"] < 30:
        continue
    case_acts = [a for a in sample_activities if a["_matter_uid"] == uid and a.get("activity_date")]
    if not case_acts:
        continue

    from datetime import datetime
    open_d = datetime.strptime(m["open_date"], "%Y-%m-%d")
    close_d = datetime.strptime(m["close_date"], "%Y-%m-%d")
    total_days = (close_d - open_d).days
    if total_days <= 0:
        continue

    q1, q2, q3, q4 = 0, 0, 0, 0
    for a in case_acts:
        try:
            ad = datetime.strptime(a["activity_date"], "%Y-%m-%d")
        except:
            continue
        bill = a.get("billable_amount") or 0
        elapsed = (ad - open_d).days
        pct_through = elapsed / total_days
        if pct_through < 0.25:
            q1 += bill
        elif pct_through < 0.50:
            q2 += bill
        elif pct_through < 0.75:
            q3 += bill
        else:
            q4 += bill

    total = q1 + q2 + q3 + q4
    if total > 0:
        stage_data["first_quarter"].append(q1 / total * 100)
        stage_data["first_half"].append((q1 + q2) / total * 100)
        stage_data["third_quarter"].append((q1 + q2 + q3) / total * 100)

print(f"\nCost accumulation through case lifecycle (top 50 cases):")
for label, vals in [
    ("First 25% of duration", stage_data["first_quarter"]),
    ("First 50% of duration", stage_data["first_half"]),
    ("First 75% of duration", stage_data["third_quarter"]),
]:
    if vals:
        print(f"  {label:30s}  median={statistics.median(vals):>5.1f}% of total cost  mean={statistics.mean(vals):>5.1f}%")

print(f"\n{'='*70}")
print(f"RECOMMENDED FLAT FEE STRUCTURE")
print(f"{'='*70}")
print("""
Based on the data, here are recommended flat-fee tiers:

Tier 1 — SIMPLE UNCONTESTED ($X flat)
  Profile: No children, no opposing counsel, cooperative spouse
  Data:    ~XX% of cases, median ~$X,XXX, completes in ~X months

Tier 2 — STANDARD UNCONTESTED ($X flat)
  Profile: Children involved, no opposing counsel, agreed terms
  Data:    ~XX% of cases, median ~$X,XXX, completes in ~X months

Tier 3 — NEGOTIATED ($X flat)
  Profile: Opposing counsel involved, some negotiation needed
  Data:    ~XX% of cases, median ~$X,XXX, completes in ~X months

Tier 4 — COMPLEX NEGOTIATED ($X flat)
  Profile: Opposing counsel + children + property/asset disputes
  Data:    ~XX% of cases, median ~$X,XXX, completes in ~XX months

Tier 5 — CONTESTED (hourly with retainer)
  Profile: High conflict, custody disputes, extensive discovery
  Data:    ~XX% of cases, too variable for flat fee

(Exact numbers filled in from analysis above)
""")
