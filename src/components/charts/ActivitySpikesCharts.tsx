"use client"

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts"
import { ChartCard } from "./ChartCard"

const BLUE = "#2563eb"
const SLATE = "#64748b"
const ROSE = "#e11d48"

interface FirmWeekRow {
  week: string
  billable: number
  rolling4: number
}

export function FirmWeeklyBillableChart({
  data,
  spikeWeeks,
}: {
  data: FirmWeekRow[]
  /** ISO week_starts where at least one spike was detected; rendered as red dots */
  spikeWeeks: Set<string>
}) {
  const spikeDots = data.filter((d) => spikeWeeks.has(d.week))

  return (
    <ChartCard
      title="Firm-wide weekly billable"
      description="Total billable per ISO week with 4-week rolling average. Red dots mark weeks containing at least one detected spike."
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="week" fontSize={10} tick={{ fill: SLATE }} interval={Math.max(0, Math.floor(data.length / 16))} />
            <YAxis
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value, name) => [
                `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="billable"
              stroke={BLUE}
              fill={BLUE}
              fillOpacity={0.12}
              strokeWidth={1.5}
              name="Weekly billable"
            />
            <Line
              type="monotone"
              dataKey="rolling4"
              stroke={SLATE}
              strokeWidth={2}
              dot={false}
              name="4-week rolling avg"
            />
            {spikeDots.map((d) => (
              <ReferenceDot
                key={d.week}
                x={d.week}
                y={d.billable}
                r={3}
                fill={ROSE}
                stroke="white"
                strokeWidth={1}
                ifOverflow="extendDomain"
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
