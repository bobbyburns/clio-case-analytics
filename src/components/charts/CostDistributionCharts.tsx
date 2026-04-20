"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "./ChartCard"
import type { HistogramBin, StatsResult } from "@/lib/types"

const BLUE = "#2563eb"
const SLATE = "#64748b"

const PERCENTILE_COLORS: Record<string, string> = {
  p10: "#94a3b8",
  p25: "#64748b",
  p50: "#2563eb",
  p75: "#64748b",
  p90: "#94a3b8",
}

export function CostHistogram({
  bins,
  stats,
}: {
  bins: HistogramBin[]
  stats: StatsResult
}) {
  const chartData = bins.map((b) => ({
    label: `$${Math.round(b.binStart / 1000)}k`,
    count: b.count,
  }))

  return (
    <ChartCard
      title="Cost Distribution Histogram"
      description="Distribution of total billable amounts with percentile reference lines"
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" fontSize={11} tick={{ fill: SLATE }} />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} name="Cases" />
            {(["p10", "p25", "p50", "p75", "p90"] as const).map((pKey) => {
              const value = stats[pKey]
              const binIdx = bins.findIndex((b) => value >= b.binStart && value < b.binEnd)
              if (binIdx < 0) return null
              return (
                <ReferenceLine
                  key={pKey}
                  x={chartData[binIdx]?.label}
                  stroke={PERCENTILE_COLORS[pKey]}
                  strokeDasharray={pKey === "p50" ? "0" : "4 4"}
                  strokeWidth={pKey === "p50" ? 2 : 1}
                  label={{
                    value: pKey.toUpperCase(),
                    position: "top",
                    fontSize: 10,
                    fill: PERCENTILE_COLORS[pKey],
                  }}
                />
              )
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
