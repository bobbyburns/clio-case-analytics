"use client"

import {
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ZAxis,
} from "recharts"
import { ChartCard } from "./ChartCard"
import type { HistogramBin, StatsResult } from "@/lib/types"

const BLUE = "#2563eb"
const SLATE = "#64748b"
const LIGHT_BLUE = "#93c5fd"

export function DurationHistogram({
  bins,
  stats,
}: {
  bins: HistogramBin[]
  stats: StatsResult
}) {
  const chartData = bins.map((b) => ({
    label: `${Math.round(b.binStart / 30.44)}`,
    count: b.count,
  }))

  return (
    <ChartCard
      title="Duration Distribution"
      description="Case duration in months"
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="label"
              fontSize={11}
              tick={{ fill: SLATE }}
              label={{ value: "Months", position: "insideBottom", offset: -2, fontSize: 11 }}
            />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} name="Cases" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

interface ScatterPoint {
  durationMonths: number
  cost: number
  label: string
}

export function DurationVsCostScatter({
  data,
  trendSlope,
  trendIntercept,
}: {
  data: ScatterPoint[]
  trendSlope: number
  trendIntercept: number
}) {
  // Calculate trend line endpoints
  const xValues = data.map((d) => d.durationMonths)
  const xMin = Math.min(...xValues)
  const xMax = Math.max(...xValues)
  const trendData = [
    { x: xMin, y: trendSlope * xMin + trendIntercept },
    { x: xMax, y: trendSlope * xMax + trendIntercept },
  ]

  return (
    <ChartCard
      title="Duration vs Cost"
      description="Relationship between case duration and total billable amount"
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="durationMonths"
              name="Duration (months)"
              fontSize={11}
              tick={{ fill: SLATE }}
              label={{ value: "Duration (months)", position: "insideBottom", offset: -2, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="cost"
              name="Cost"
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <ZAxis range={[20, 20]} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value, name) =>
                name === "Cost"
                  ? [`$${Number(value).toLocaleString()}`, name]
                  : [Number(value).toFixed(1), name]
              }
            />
            <Scatter data={data} fill={BLUE} fillOpacity={0.5} />
            <Scatter
              data={trendData.map((d) => ({ durationMonths: d.x, cost: d.y }))}
              fill="none"
              line={{ stroke: "#ef4444", strokeWidth: 2, strokeDasharray: "6 3" }}
              shape={() => null}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
