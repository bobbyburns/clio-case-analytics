"use client"

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "./ChartCard"

const BLUE = "#2563eb"
const SLATE = "#64748b"

interface CostDistItem {
  label: string
  count: number
}

interface TimeSeriesItem {
  period: string
  count: number
}

export function CostDistributionSummary({ data }: { data: CostDistItem[] }) {
  return (
    <ChartCard title="Cost Distribution" description="Total billable amount distribution">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" fontSize={11} tick={{ fill: SLATE }} />
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

export function CasesOverTime({ data }: { data: TimeSeriesItem[] }) {
  return (
    <ChartCard title="Cases Over Time" description="Cases opened per quarter">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" fontSize={11} tick={{ fill: SLATE }} />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={BLUE}
              strokeWidth={2}
              dot={{ fill: BLUE, r: 3 }}
              name="Cases Opened"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
