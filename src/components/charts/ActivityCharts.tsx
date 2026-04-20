"use client"

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
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
const INDIGO = "#4f46e5"
const ROSE = "#e11d48"

const PIE_COLORS = [BLUE, EMERALD, AMBER, INDIGO, ROSE]

interface PieData {
  name: string
  value: number
}

interface BarData {
  name: string
  billable: number
  nonBillable: number
}

interface UserData {
  name: string
  amount: number
}

interface RateData {
  name: string
  value: number
}

export function ActivityTypePie({ data }: { data: PieData[] }) {
  return (
    <ChartCard title="Activity Type Split" description="TimeEntry vs ExpenseEntry">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
              label={({ name, percent }: { name?: string; percent?: number }) =>
                `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`
              }
              labelLine={true}
              fontSize={12}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function BillableVsNonBillable({ data }: { data: BarData[] }) {
  return (
    <ChartCard title="Billable vs Non-Billable" description="Hours split by billability">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" fontSize={11} tick={{ fill: SLATE }} />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="billable" fill={BLUE} radius={[4, 4, 0, 0]} name="Billable" />
            <Bar dataKey="nonBillable" fill={SLATE} radius={[4, 4, 0, 0]} name="Non-Billable" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function TopUsersByBillable({ data }: { data: UserData[] }) {
  return (
    <ChartCard title="Top 10 Users by Billable Amount" description="Users ranked by total billable">
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
              formatter={(value) => [`$${Number(value).toLocaleString()}`, "Billable Amount"]}
            />
            <Bar dataKey="amount" fill={BLUE} radius={[0, 4, 4, 0]} name="Billable Amount" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function FlatRateBreakdown({ data }: { data: RateData[] }) {
  return (
    <ChartCard title="Flat Rate vs Hourly" description="Breakdown of billing methods">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
              label={({ name, percent }: { name?: string; percent?: number }) =>
                `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`
              }
              labelLine={true}
              fontSize={12}
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
