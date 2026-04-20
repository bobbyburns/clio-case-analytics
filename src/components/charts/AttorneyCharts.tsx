"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "./ChartCard"

const BLUE = "#2563eb"
const SLATE = "#64748b"

interface AttorneyRevData {
  name: string
  revenue: number
}

export function RevenueByAttorney({ data }: { data: AttorneyRevData[] }) {
  return (
    <ChartCard title="Revenue by Attorney" description="Total billable amount per attorney">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis
              type="number"
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <YAxis type="category" dataKey="name" fontSize={11} tick={{ fill: SLATE }} width={120} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) => [`$${Number(value).toLocaleString()}`, "Revenue"]}
            />
            <Bar dataKey="revenue" fill={BLUE} radius={[0, 4, 4, 0]} name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
