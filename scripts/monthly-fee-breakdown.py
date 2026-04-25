"""
Detailed breakdown of monthly flat fee math.
Shows exactly how each fee level maps to actual cases.
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

matters = fetch_all("clio_matters",
    "mapped_category=eq.Divorce&status=eq.Closed&or=(disregarded.is.null,disregarded.eq.false)"
    "&select=unique_id,display_number,total_billable,total_hours,duration_days")

cases = [m for m in matters if (m.get("total_billable") or 0) > 0 and m.get("duration_days") and m["duration_days"] > 0]

total_revenue = sum(m["total_billable"] for m in cases)
total_case_months = sum(max(m["duration_days"] / 30.4, 1) for m in cases)

print(f"{'='*70}")
print(f"HOW THE MATH WORKS — {len(cases)} CLOSED DIVORCE CASES")
print(f"{'='*70}")

print(f"""
THE FORMULA:
  Total revenue under flat fee = SUM( monthly_fee x duration_months ) for each case

  We know:
    Total actual revenue billed:  ${total_revenue:>12,.0f}
    Total case-months served:     {total_case_months:>12,.0f} months
    Effective rate today:         ${total_revenue/total_case_months:>12,.0f}/month (what you actually earn per case-month)

  So the breakeven flat fee = ${total_revenue:,.0f} / {total_case_months:,.0f} months = ${total_revenue/total_case_months:,.0f}/month
  For +50%: ${total_revenue*1.5:,.0f} / {total_case_months:,.0f} months = ${total_revenue*1.5/total_case_months:,.0f}/month
""")

# Show the actual case-month distribution
print(f"{'='*70}")
print(f"CASE DURATION DISTRIBUTION (this is the multiplier)")
print(f"{'='*70}")
durations = sorted([m["duration_days"] / 30.4 for m in cases])
for label, lo, hi in [("1-2 months", 0, 2.5), ("3-4 months", 2.5, 4.5), ("5-6 months", 4.5, 6.5),
                       ("7-9 months", 6.5, 9.5), ("10-12 months", 9.5, 12.5),
                       ("13-18 months", 12.5, 18.5), ("19-24 months", 18.5, 24.5), ("25+ months", 24.5, 999)]:
    subset = [d for d in durations if lo <= d < hi]
    cases_in = [m for m in cases if lo <= m["duration_days"]/30.4 < hi]
    if subset:
        actual_rev = sum(m["total_billable"] for m in cases_in)
        print(f"  {label:15s}  {len(subset):4d} cases ({len(subset)/len(cases)*100:5.1f}%)  "
              f"actual rev=${actual_rev:>10,.0f}  "
              f"avg billed=${actual_rev/len(subset):>7,.0f}/case")

# Deep dive on $2,500/month
print(f"\n{'='*70}")
print(f"DEEP DIVE: $2,500/MONTH FLAT FEE")
print(f"{'='*70}")

fee = 2500
print(f"\nWhat each case would pay at ${fee:,}/month:")
print(f"{'Duration':<15s} {'Cases':>6s} {'Flat/Case':>12s} {'Actual Avg':>12s} {'Delta':>12s} {'Firm wins?':>12s}")
print(f"{'-'*15} {'-'*6} {'-'*12} {'-'*12} {'-'*12} {'-'*12}")

for label, lo, hi in [("1-2 months", 0, 2.5), ("3-4 months", 2.5, 4.5), ("5-6 months", 4.5, 6.5),
                       ("7-9 months", 6.5, 9.5), ("10-12 months", 9.5, 12.5),
                       ("13-18 months", 12.5, 18.5), ("19-24 months", 18.5, 24.5), ("25+ months", 24.5, 999)]:
    subset = [m for m in cases if lo <= m["duration_days"]/30.4 < hi]
    if not subset:
        continue
    avg_months = statistics.mean([m["duration_days"]/30.4 for m in subset])
    flat_per_case = fee * avg_months
    actual_avg = statistics.mean([m["total_billable"] for m in subset])
    delta = flat_per_case - actual_avg
    wins = "FIRM WINS" if delta > 0 else "FIRM LOSES"
    print(f"  {label:<13s} {len(subset):>6d} ${flat_per_case:>11,.0f} ${actual_avg:>11,.0f} ${delta:>+11,.0f}  {wins}")

flat_total = sum(fee * max(m["duration_days"]/30.4, 1) for m in cases)
print(f"\n  TOTAL:       {len(cases):>6d} ${flat_total:>11,.0f} ${total_revenue:>11,.0f} ${flat_total-total_revenue:>+11,.0f}")
print(f"  Revenue change: {(flat_total-total_revenue)/total_revenue*100:+.1f}%")

# Show case-by-case: who pays more, who pays less
print(f"\n  Case-by-case breakdown:")
case_deltas = []
for m in cases:
    months = max(m["duration_days"]/30.4, 1)
    flat = fee * months
    actual = m["total_billable"]
    effective_actual_monthly = actual / months
    case_deltas.append({
        "display": m["display_number"],
        "months": months,
        "actual": actual,
        "flat": flat,
        "delta": flat - actual,
        "actual_monthly": effective_actual_monthly,
    })

# What did the firm ACTUALLY earn per month on each case?
actual_monthlies = sorted([c["actual_monthly"] for c in case_deltas])
print(f"\n  What you ACTUALLY earn per case-month today:")
print(f"    P10:    ${actual_monthlies[int(len(actual_monthlies)*0.10)]:>8,.0f}/mo")
print(f"    P25:    ${actual_monthlies[int(len(actual_monthlies)*0.25)]:>8,.0f}/mo")
print(f"    Median: ${statistics.median(actual_monthlies):>8,.0f}/mo")
print(f"    Mean:   ${statistics.mean(actual_monthlies):>8,.0f}/mo")
print(f"    P75:    ${actual_monthlies[int(len(actual_monthlies)*0.75)]:>8,.0f}/mo")
print(f"    P90:    ${actual_monthlies[int(len(actual_monthlies)*0.90)]:>8,.0f}/mo")

print(f"\n  At ${fee:,}/month, you LOSE money on cases that currently bill above ${fee:,}/mo effective.")
print(f"  That is {sum(1 for c in case_deltas if c['actual_monthly'] > fee)} cases ({sum(1 for c in case_deltas if c['actual_monthly'] > fee)/len(cases)*100:.0f}%)")
print(f"  You WIN money on cases that currently bill below ${fee:,}/mo effective.")
print(f"  That is {sum(1 for c in case_deltas if c['actual_monthly'] <= fee)} cases ({sum(1 for c in case_deltas if c['actual_monthly'] <= fee)/len(cases)*100:.0f}%)")

# Cases where you lose the most
losses = sorted([c for c in case_deltas if c["delta"] < 0], key=lambda x: x["delta"])
print(f"\n  Cases where firm loses most at ${fee:,}/mo:")
print(f"  {'Case':<40s} {'Duration':>8s} {'Actual':>10s} {'Flat Fee':>10s} {'Loss':>10s} {'Actual/Mo':>10s}")
for c in losses[:10]:
    print(f"  {c['display'][:38]:<40s} {c['months']:>6.1f}mo ${c['actual']:>9,.0f} ${c['flat']:>9,.0f} ${c['delta']:>+9,.0f} ${c['actual_monthly']:>9,.0f}")

# Now model $2500 with a trial bump
print(f"\n{'='*70}")
print(f"$2,500/MONTH WITH GUARDRAILS")
print(f"{'='*70}")

for scenario_name, base, bump_fee, bump_month, hours_cap in [
    ("Flat $2,500 (no guardrails)", 2500, 2500, 999, 999),
    ("$2,500 base, $4,000 after 12mo", 2500, 4000, 12, 999),
    ("$2,500 base, $5,000 after 9mo", 2500, 5000, 9, 999),
    ("$2,500 + hourly after 15h/mo", 2500, 2500, 999, 15),
]:
    total = 0
    for m in cases:
        months = max(m["duration_days"]/30.4, 1)
        if months <= bump_month:
            total += base * months
        else:
            total += base * bump_month + bump_fee * (months - bump_month)
    pct = (total - total_revenue) / total_revenue * 100
    print(f"\n  {scenario_name}:")
    print(f"    Revenue: ${total:>12,.0f}  ({pct:+.1f}%)")
    print(f"    Per case avg: ${total/len(cases):>8,.0f}  (currently ${total_revenue/len(cases):>8,.0f})")

# Annual analysis — what does this look like per year?
print(f"\n{'='*70}")
print(f"ANNUAL VIEW: WHAT DOES $2,500/MO LOOK LIKE?")
print(f"{'='*70}")

# Group cases by open year
by_year = {}
for m in cases:
    year = m.get("open_date", "")[:4]
    if year:
        by_year.setdefault(year, []).append(m)

print(f"\n  {'Year':<6s} {'Cases':>6s} {'Actual Rev':>12s} {'@$2500/mo':>12s} {'Delta':>12s} {'Avg Case':>10s} {'Avg Dur':>8s}")
for year in sorted(by_year.keys()):
    yr_cases = by_year[year]
    yr_actual = sum(m["total_billable"] for m in yr_cases)
    yr_flat = sum(2500 * max(m["duration_days"]/30.4, 1) for m in yr_cases)
    yr_avg = yr_actual / len(yr_cases)
    yr_dur = statistics.mean([m["duration_days"]/30.4 for m in yr_cases])
    print(f"  {year:<6s} {len(yr_cases):>6d} ${yr_actual:>11,.0f} ${yr_flat:>11,.0f} ${yr_flat-yr_actual:>+11,.0f} ${yr_avg:>9,.0f} {yr_dur:>6.1f}mo")
