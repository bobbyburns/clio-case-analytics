"""
Model: Monthly recurring flat fee for divorce cases.
What monthly amount across all cases would increase revenue by 50%?
"""
import json, urllib.request, statistics, sys

SRK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZld3Z6cWt5cGZ3emFrcHl4Y3VwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjcxMTQ2MywiZXhwIjoyMDkyMjg3NDYzfQ.RwkXuhGMs4Pwfp8YlKgpCSHHFr28kQcqNh2qgt853NY"
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

print("Fetching data...", file=sys.stderr)
matters = fetch_all("clio_matters",
    "mapped_category=eq.Divorce&status=eq.Closed&or=(disregarded.is.null,disregarded.eq.false)"
    "&select=unique_id,display_number,total_billable,total_hours,duration_days")

cases = [m for m in matters if (m.get("total_billable") or 0) > 0 and m.get("duration_days") and m["duration_days"] > 0]

print(f"\n{'='*70}")
print(f"MONTHLY FLAT FEE MODEL — {len(cases)} CLOSED DIVORCE CASES")
print(f"{'='*70}")

# Current reality
total_revenue = sum(m["total_billable"] for m in cases)
total_case_months = sum(max(m["duration_days"] / 30.4, 1) for m in cases)
avg_duration_months = statistics.mean([m["duration_days"] / 30.4 for m in cases])
median_duration_months = statistics.median([m["duration_days"] / 30.4 for m in cases])
avg_revenue_per_case = total_revenue / len(cases)
current_effective_monthly = total_revenue / total_case_months

print(f"\n--- CURRENT STATE ---")
print(f"  Total cases:              {len(cases):>10,}")
print(f"  Total revenue:            ${total_revenue:>10,.0f}")
print(f"  Avg revenue/case:         ${avg_revenue_per_case:>10,.0f}")
print(f"  Median revenue/case:      ${statistics.median([m['total_billable'] for m in cases]):>10,.0f}")
print(f"  Total case-months:        {total_case_months:>10,.0f}")
print(f"  Avg duration:             {avg_duration_months:>10.1f} months")
print(f"  Median duration:          {median_duration_months:>10.1f} months")
print(f"  Effective $/month (now):  ${current_effective_monthly:>10,.0f}")

# Target: 50% revenue increase
target_revenue = total_revenue * 1.5
target_monthly = target_revenue / total_case_months

print(f"\n--- TARGET: +50% REVENUE ---")
print(f"  Target total revenue:     ${target_revenue:>10,.0f}")
print(f"  Required flat monthly:    ${target_monthly:>10,.0f}/month")
print(f"  Revenue increase:         ${target_revenue - total_revenue:>10,.0f}")

# Per-case analysis: what would each case have paid under flat monthly?
print(f"\n{'='*70}")
print(f"FLAT MONTHLY FEE SCENARIOS")
print(f"{'='*70}")

for monthly_fee in [750, 1000, 1250, 1500, 1750, 2000, 2500, 3000]:
    flat_total = sum(monthly_fee * max(m["duration_days"] / 30.4, 1) for m in cases)
    pct_change = (flat_total - total_revenue) / total_revenue * 100

    # Winners and losers (from firm's perspective)
    winners = 0  # cases where flat fee > actual (firm makes more)
    losers = 0   # cases where flat fee < actual (firm makes less)
    biggest_loss = 0
    biggest_win = 0
    for m in cases:
        months = max(m["duration_days"] / 30.4, 1)
        flat_cost = monthly_fee * months
        actual = m["total_billable"]
        delta = flat_cost - actual
        if delta > 0:
            winners += 1
            biggest_win = max(biggest_win, delta)
        else:
            losers += 1
            biggest_loss = min(biggest_loss, delta)

    print(f"\n  ${monthly_fee:,}/month:")
    print(f"    Total revenue:      ${flat_total:>10,.0f}  ({pct_change:+.1f}%)")
    print(f"    Firm wins on:       {winners:>4d} cases ({winners/len(cases)*100:.0f}%)")
    print(f"    Firm loses on:      {losers:>4d} cases ({losers/len(cases)*100:.0f}%)")
    print(f"    Biggest loss/case:  ${biggest_loss:>10,.0f}")
    print(f"    Biggest win/case:   ${biggest_win:>10,.0f}")

# Two-tier model: base rate + trial rate
print(f"\n{'='*70}")
print(f"TWO-TIER MODEL: BASE + TRIAL BUMP")
print(f"{'='*70}")
print(f"Assumption: cases > 12 months are 'trial track' — elevated rate")

short_cases = [m for m in cases if m["duration_days"] / 30.4 <= 12]
long_cases = [m for m in cases if m["duration_days"] / 30.4 > 12]

print(f"\n  Short cases (<=12mo): {len(short_cases)} ({len(short_cases)/len(cases)*100:.0f}%)")
print(f"    Avg duration: {statistics.mean([m['duration_days']/30.4 for m in short_cases]):.1f} months")
print(f"    Avg billed:   ${statistics.mean([m['total_billable'] for m in short_cases]):,.0f}")
print(f"    Total revenue: ${sum(m['total_billable'] for m in short_cases):,.0f}")

print(f"\n  Long cases (>12mo):  {len(long_cases)} ({len(long_cases)/len(cases)*100:.0f}%)")
print(f"    Avg duration: {statistics.mean([m['duration_days']/30.4 for m in long_cases]):.1f} months")
print(f"    Avg billed:   ${statistics.mean([m['total_billable'] for m in long_cases]):,.0f}")
print(f"    Total revenue: ${sum(m['total_billable'] for m in long_cases):,.0f}")

for base, trial in [(1000, 2000), (1000, 2500), (1250, 2500), (1250, 3000), (1500, 2500), (1500, 3000)]:
    flat_total = 0
    for m in cases:
        months = max(m["duration_days"] / 30.4, 1)
        if months <= 12:
            flat_total += base * months
        else:
            flat_total += base * 12 + trial * (months - 12)

    pct_change = (flat_total - total_revenue) / total_revenue * 100
    print(f"\n  ${base:,}/mo base + ${trial:,}/mo trial (after 12mo):")
    print(f"    Total revenue: ${flat_total:>10,.0f}  ({pct_change:+.1f}%)")

# What-if: varying the trial threshold
print(f"\n{'='*70}")
print(f"SENSITIVITY: WHEN DOES TRIAL RATE KICK IN?")
print(f"{'='*70}")
print(f"  Base=$1,250/mo, Trial=$2,500/mo")
for threshold in [6, 9, 12, 15, 18]:
    flat_total = 0
    for m in cases:
        months = max(m["duration_days"] / 30.4, 1)
        if months <= threshold:
            flat_total += 1250 * months
        else:
            flat_total += 1250 * threshold + 2500 * (months - threshold)
    pct_change = (flat_total - total_revenue) / total_revenue * 100
    print(f"  Bump at {threshold:>2d} months:  ${flat_total:>10,.0f}  ({pct_change:+.1f}%)")

# Distribution of what clients would pay per tier
print(f"\n{'='*70}")
print(f"CLIENT IMPACT: WHAT WOULD EACH CASE PAY?")
print(f"{'='*70}")
print(f"  Model: $1,250/mo base, $2,500/mo after 12 months")

buckets = [
    (0, 3000, "Would pay <$3K"),
    (3000, 5000, "Would pay $3K-$5K"),
    (5000, 7500, "Would pay $5K-$7.5K"),
    (7500, 10000, "Would pay $7.5K-$10K"),
    (10000, 15000, "Would pay $10K-$15K"),
    (15000, 25000, "Would pay $15K-$25K"),
    (25000, 50000, "Would pay $25K-$50K"),
    (50000, 999999, "Would pay $50K+"),
]

flat_costs = []
for m in cases:
    months = max(m["duration_days"] / 30.4, 1)
    if months <= 12:
        fc = 1250 * months
    else:
        fc = 1250 * 12 + 2500 * (months - 12)
    flat_costs.append((fc, m["total_billable"], m))

for lo, hi, label in buckets:
    subset = [(fc, actual) for fc, actual, _ in flat_costs if lo <= fc < hi]
    if subset:
        avg_flat = statistics.mean([fc for fc, _ in subset])
        avg_actual = statistics.mean([a for _, a in subset])
        print(f"  {label:25s}  n={len(subset):4d}  avg flat=${avg_flat:>7,.0f}  avg actual=${avg_actual:>7,.0f}  delta=${avg_flat-avg_actual:>+7,.0f}")

# The outlier problem
print(f"\n{'='*70}")
print(f"OUTLIER RISK: CASES WHERE FIRM LOSES MONEY")
print(f"{'='*70}")
print(f"  Under $1,250/$2,500 model, cases where flat fee < actual billed:")
losses = [(fc, actual, m) for fc, actual, m in flat_costs if fc < actual]
losses.sort(key=lambda x: x[0] - x[1])
print(f"  {len(losses)} cases where firm would have earned less ({len(losses)/len(cases)*100:.0f}%)")
print(f"  Total lost revenue: ${sum(actual - fc for fc, actual, _ in losses):,.0f}")
if losses:
    print(f"\n  Top 10 biggest losses:")
    for fc, actual, m in losses[:10]:
        months = max(m["duration_days"] / 30.4, 1)
        print(f"    Actual: ${actual:>8,.0f}  Flat: ${fc:>8,.0f}  Loss: ${actual-fc:>8,.0f}  ({months:.0f}mo)  {m['display_number'][:40]}")

# The win side
gains = [(fc, actual, m) for fc, actual, m in flat_costs if fc >= actual]
gains.sort(key=lambda x: x[0] - x[1], reverse=True)
print(f"\n  {len(gains)} cases where firm would have earned more ({len(gains)/len(cases)*100:.0f}%)")
print(f"  Total gained revenue: ${sum(fc - actual for fc, actual, _ in gains):,.0f}")
