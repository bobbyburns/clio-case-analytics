"use client"

import { Card, CardContent } from "@/components/ui/card"

interface Props {
  entity: "client" | "matter"
  firmBreakEven: number
  medianBreakEven: number
  meanBreakEven: number
}

export function BreakEvenExplainer({
  entity,
  firmBreakEven,
  medianBreakEven,
  meanBreakEven,
}: Props) {
  const noun = entity === "client" ? "client" : "matter"
  const nouns = entity === "client" ? "clients" : "matters"
  const Noun = entity === "client" ? "Client" : "Matter"

  const meanVsMedian =
    medianBreakEven > 0 ? meanBreakEven / medianBreakEven : 1
  const medianVsFirm =
    firmBreakEven > 0 ? medianBreakEven / firmBreakEven : 1

  const interpretation = buildInterpretation(noun, nouns, meanVsMedian, medianVsFirm)

  return (
    <Card className="bg-blue-50/40 border-blue-100">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start gap-3">
          <div className="inline-flex size-6 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-bold shrink-0">
            ?
          </div>
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-foreground">
              Three different &ldquo;break-even&rdquo; numbers — each answers a different
              question.
            </p>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">Firm-Level</strong> — the one retainer rate at
                which <em>total firm revenue stays exactly where it is today</em>. Weighted by
                time, so your biggest and longest-running {nouns} pull it toward whatever they
                currently generate per month.
                <span className="ml-1 text-[11px]">
                  (total revenue ÷ total active months)
                </span>
              </li>
              <li>
                <strong className="text-foreground">Per-{Noun} Median</strong> — the &ldquo;typical
                {" "}
                {noun}&rdquo; benchmark. Half your {nouns} currently generate more than this per
                active month, half generate less. Every {noun} counts once regardless of size or
                tenure.
              </li>
              <li>
                <strong className="text-foreground">Per-{Noun} Mean</strong> — the simple
                arithmetic average of every {noun}&rsquo;s $/month. Outlier-sensitive: a handful
                of high-$/month {nouns} pull it up. Shown beside the median to expose skew.
              </li>
            </ul>
            <details className="group">
              <summary className="cursor-pointer list-none text-xs font-medium text-blue-700 hover:text-blue-900 select-none">
                <span className="group-open:hidden">Show how to read the gap →</span>
                <span className="hidden group-open:inline">Hide interpretation ←</span>
              </summary>
              <div className="mt-3 rounded-md bg-white/70 p-3 border border-blue-100 text-xs text-muted-foreground space-y-2">
                <p className="font-semibold text-foreground">Your current numbers:</p>
                <ul className="space-y-1 pl-4 list-disc">
                  <li>
                    Firm-Level = <strong>${Math.round(firmBreakEven).toLocaleString()}</strong>
                  </li>
                  <li>
                    Per-{Noun} Median = <strong>${Math.round(medianBreakEven).toLocaleString()}</strong>
                  </li>
                  <li>
                    Per-{Noun} Mean = <strong>${Math.round(meanBreakEven).toLocaleString()}</strong>
                  </li>
                </ul>
                {interpretation.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </details>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function buildInterpretation(
  noun: string,
  nouns: string,
  meanVsMedian: number,
  medianVsFirm: number,
): string[] {
  const lines: string[] = []

  if (meanVsMedian > 1.3) {
    lines.push(
      `Mean is ${meanVsMedian.toFixed(1)}× the median — your revenue is concentrated in a handful of high-$/month ${nouns}. A retainer near the median works for most but leaves significant money on the table with your top ${nouns}. Consider tiered pricing.`,
    )
  } else if (meanVsMedian > 1.1) {
    lines.push(
      `Mean is moderately higher than median — a few ${nouns} pay more per month than the typical one, but the book isn't wildly skewed.`,
    )
  } else {
    lines.push(
      `Mean and median are close — your book is fairly uniform on a per-month basis, without a few outlier ${nouns} dominating.`,
    )
  }

  if (medianVsFirm > 1.15) {
    lines.push(
      `Median is higher than firm-level, which means your biggest / longest-tenured ${nouns} earn less per month than the typical ${noun}. Long-tenure anchor ${nouns} with modest monthly density are dragging the firm-level number down — a firm-level retainer would be a pay cut for most of your book.`,
    )
  } else if (medianVsFirm < 0.85) {
    lines.push(
      `Median is lower than firm-level, which means your biggest ${nouns} earn more per month than the typical one. A firm-level retainer would overcharge most of your book.`,
    )
  } else {
    lines.push(
      `Firm-level and median are close — per-month economics are roughly consistent between your biggest ${nouns} and the rest of the book.`,
    )
  }

  lines.push(
    `Practical rule of thumb: target the median for broad acceptance, aim above firm-level if you want total revenue to grow, and use the mean to understand how much upside you'd cap by flattening pricing.`,
  )

  return lines
}
