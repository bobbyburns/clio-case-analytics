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
  Legend,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "./ChartCard"

const BLUE = "#2563eb"
const EMERALD = "#059669"
const SLATE = "#64748b"
const AMBER = "#d97706"

interface QuarterlyData {
  period: string
  opened: number
  closed: number
}

interface QuarterlyCost {
  period: string
  avgCost: number
}

interface QuarterlyRevenue {
  period: string
  revenue: number
}

export function CasesPerQuarter({ data }: { data: QuarterlyData[] }) {
  return (
    <ChartCard title="Cases Opened & Closed per Quarter" description="Quarterly case volume trends">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" fontSize={11} tick={{ fill: SLATE }} />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="opened"
              stroke={BLUE}
              strokeWidth={2}
              dot={{ fill: BLUE, r: 3 }}
              name="Opened"
            />
            <Line
              type="monotone"
              dataKey="closed"
              stroke={EMERALD}
              strokeWidth={2}
              dot={{ fill: EMERALD, r: 3 }}
              name="Closed"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function AvgCostPerQuarter({ data }: { data: QuarterlyCost[] }) {
  return (
    <ChartCard title="Average Cost per Quarter" description="Mean total billable by quarter of case opening">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" fontSize={11} tick={{ fill: SLATE }} />
            <YAxis
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) => [`$${Number(value).toLocaleString()}`, "Avg Cost"]}
            />
            <Line
              type="monotone"
              dataKey="avgCost"
              stroke={AMBER}
              strokeWidth={2}
              dot={{ fill: AMBER, r: 3 }}
              name="Avg Cost"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function RevenuePerQuarter({ data }: { data: QuarterlyRevenue[] }) {
  return (
    <ChartCard title="Revenue per Quarter" description="Total billable amount by quarter">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="period" fontSize={11} tick={{ fill: SLATE }} />
            <YAxis
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) => [`$${Number(value).toLocaleString()}`, "Revenue"]}
            />
            <Bar dataKey="revenue" fill={BLUE} radius={[4, 4, 0, 0]} name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
