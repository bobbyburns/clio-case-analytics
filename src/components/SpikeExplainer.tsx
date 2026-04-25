"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Lightbulb } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils/format"

const SAMPLE_WEEKS = [
  { week: "Week 1", billable: 220 },
  { week: "Week 2", billable: 240 },
  { week: "Week 3", billable: 200 },
  { week: "Week 4", billable: 180 },
  { week: "Week 5", billable: 1450, isSpike: true },
  { week: "Week 6", billable: 230 },
  { week: "Week 7", billable: 210 },
  { week: "Week 8", billable: 250 },
]

const SAMPLE_MEDIAN = 225 // median of [180, 200, 210, 220, 230, 240, 250, 1450]
const SAMPLE_RATIO = SAMPLE_WEEKS[4].billable / SAMPLE_MEDIAN
const SAMPLE_THRESHOLD = 2.5
const SAMPLE_FLOOR = 250

export function SpikeExplainer() {
  const [open, setOpen] = useState(false)

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left w-full"
        >
          {open ? (
            <ChevronDown className="size-4 text-blue-700" />
          ) : (
            <ChevronRight className="size-4 text-blue-700" />
          )}
          <Lightbulb className="size-4 text-blue-700" />
          <CardTitle className="text-base text-blue-900">
            How activity spikes work {open ? "" : "(click to expand)"}
          </CardTitle>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6 text-sm">
          <section>
            <h3 className="font-semibold mb-1">What this page is for</h3>
            <p className="text-muted-foreground leading-relaxed">
              A flat monthly retainer captures steady work but loses money on big weeks
              where, say, a deposition runs three days or a hearing eats up a Friday plus
              prep. This page identifies those big weeks (&ldquo;spikes&rdquo;) so you
              can see what activities trigger them and decide whether to add{" "}
              <em>event-based surcharges</em> on top of the flat rate (e.g. +$500 for any
              week with a hearing).
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-1">Key terms</h3>
            <dl className="space-y-2 text-muted-foreground">
              <div>
                <dt className="font-medium text-foreground inline">Matter-week.</dt>{" "}
                <dd className="inline">
                  One row of activity for a single matter during a single ISO week
                  (Monday–Sunday). A matter that ran for a year contributes ~52 matter-weeks.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground inline">Baseline median.</dt>{" "}
                <dd className="inline">
                  The middle value of <em>this matter&rsquo;s</em> weekly billable totals.
                  Half its weeks were higher; half were lower. Median (not average) is used
                  because one big week shouldn&rsquo;t inflate the &ldquo;normal&rdquo; level.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground inline">Spike ratio.</dt>{" "}
                <dd className="inline">
                  How much higher a week&rsquo;s billable was compared to that matter&rsquo;s
                  baseline median. A 5× ratio means that week earned five times the
                  matter&rsquo;s normal week.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground inline">Absolute floor.</dt>{" "}
                <dd className="inline">
                  Minimum dollar amount before a week is even considered a spike. Without it,
                  a tiny matter with a $20 baseline would call $60 a 3× spike — noise, not
                  signal.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground inline">Sparse-baseline matter.</dt>{" "}
                <dd className="inline">
                  A matter with fewer than 8 weeks of recorded activity. We can&rsquo;t
                  compute a reliable median, so we only use the absolute floor rule. These
                  are tagged with the <span className="font-mono">absolute</span> rule
                  badge in the table.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground inline">Suggested surcharge.</dt>{" "}
                <dd className="inline">
                  A back-of-the-envelope number = the spike week&rsquo;s billable minus the
                  matter&rsquo;s baseline. Roughly: &ldquo;the retainer covers the baseline,
                  this is the extra you&rsquo;d need to charge to break even on this week.&rdquo;
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Worked example</h3>
            <p className="text-muted-foreground mb-3">
              Suppose Matter A has these eight weekly billable totals:
            </p>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
              {SAMPLE_WEEKS.map((w) => (
                <div
                  key={w.week}
                  className={`rounded-md border px-2 py-2 text-center ${
                    w.isSpike
                      ? "border-rose-300 bg-rose-50"
                      : "border-border bg-background"
                  }`}
                >
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">
                    {w.week}
                  </div>
                  <div className="text-sm font-semibold tabular-nums mt-0.5">
                    {formatCurrency(w.billable)}
                  </div>
                </div>
              ))}
            </div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Sort the eight values: $180, $200, $210, $220, $230, $240, $250, $1,450.
              </li>
              <li>
                Median is the middle = average of $220 and $230 ={" "}
                <span className="font-mono">{formatCurrency(SAMPLE_MEDIAN)}</span>.
              </li>
              <li>
                Week 5 was $1,450. Spike ratio ={" "}
                <span className="font-mono">
                  {SAMPLE_WEEKS[4].billable} ÷ {SAMPLE_MEDIAN} ={" "}
                  {SAMPLE_RATIO.toFixed(2)}×
                </span>
                .
              </li>
              <li>
                Threshold check: {SAMPLE_RATIO.toFixed(2)}× ≥{" "}
                {SAMPLE_THRESHOLD}× (default ratio) ✓
              </li>
              <li>
                Floor check: ${SAMPLE_WEEKS[4].billable} ≥ ${SAMPLE_FLOOR} (default floor) ✓
              </li>
              <li>
                Both rules pass → Week 5 is a <strong>spike</strong>. The
                table would suggest a surcharge of about{" "}
                <span className="font-mono">
                  {formatCurrency(SAMPLE_WEEKS[4].billable - SAMPLE_MEDIAN)}
                </span>{" "}
                on top of the flat retainer for that week.
              </li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold mb-1">What gets excluded (and why)</h3>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Flat-fee matters</span> —
                the matter is already on a flat fee, so a surcharge model doesn&rsquo;t apply.
              </li>
              <li>
                <span className="font-medium text-foreground">2016-11-06 Xero migration row</span>{" "}
                — a single bulk balance-forward import that would otherwise look like
                every matter&rsquo;s biggest week.
              </li>
              <li>
                <span className="font-medium text-foreground">Current ISO week</span> —
                still in progress, so partial data would understate the ratio.
              </li>
              <li>
                <span className="font-medium text-foreground">Non-billable activities</span> —
                only billable_amount &gt; 0 entries roll up to the weekly total.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold mb-1">How to use this page</h3>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>
                Adjust the ratio slider to control how aggressively spikes are detected.
                A lower threshold (1.5×) catches mild bumps; a higher threshold (4×+)
                surfaces only the clearest outliers.
              </li>
              <li>
                Use the keyword search to filter to spike weeks with specific drivers —
                try <span className="font-mono">hearing</span>,{" "}
                <span className="font-mono">deposition</span>,{" "}
                <span className="font-mono">mediation</span>,{" "}
                <span className="font-mono">trial</span>,{" "}
                <span className="font-mono">motion</span>.
              </li>
              <li>
                Click a spike row to expand and see the underlying activity records — those
                are the actual entries your team logged that week.
              </li>
              <li>
                Watch the Trigger Leaderboard at the bottom grow as you expand rows. The
                more spikes you sample, the more reliable the keyword frequencies become.
              </li>
            </ol>
          </section>
        </CardContent>
      )}
    </Card>
  )
}
