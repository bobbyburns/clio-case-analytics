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

interface GroupedCostItem {
  name: string
  medianCost: number
  count: number
}

function CostDriverChart({
  title,
  description,
  data,
}: {
  title: string
  description: string
  data: GroupedCostItem[]
}) {
  const chartData = data.map((d) => ({
    name: d.name,
    medianCost: Math.round(d.medianCost),
    count: d.count,
  }))

  return (
    <ChartCard title={title} description={description}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
            <XAxis type="number" fontSize={11} tick={{ fill: SLATE }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <YAxis
              type="category"
              dataKey="name"
              fontSize={11}
              tick={{ fill: SLATE }}
              width={120}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) => [`$${Number(value).toLocaleString()}`, "Median Cost"]}
            />
            <Bar dataKey="medianCost" fill={BLUE} radius={[0, 4, 4, 0]} name="Median Cost" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function ChildrenCostChart({ data }: { data: GroupedCostItem[] }) {
  return (
    <CostDriverChart
      title="By Number of Children"
      description="Median cost by number of children"
      data={data}
    />
  )
}

export function CountyCostChart({ data }: { data: GroupedCostItem[] }) {
  return (
    <CostDriverChart
      title="By County (Top 10)"
      description="Median cost by county"
      data={data}
    />
  )
}

export function OpposingCounselCostChart({ data }: { data: GroupedCostItem[] }) {
  return (
    <CostDriverChart
      title="By Opposing Counsel"
      description="Median cost: has opposing counsel vs not"
      data={data}
    />
  )
}

export function CaseTypeCostChart({ data }: { data: GroupedCostItem[] }) {
  return (
    <CostDriverChart
      title="By Case Type (Top 10)"
      description="Median cost by case type"
      data={data}
    />
  )
}

export function AttorneyCostChart({ data }: { data: GroupedCostItem[] }) {
  return (
    <CostDriverChart
      title="By Responsible Attorney"
      description="Median cost per attorney"
      data={data}
    />
  )
}

export function RetainerCostChart({ data }: { data: GroupedCostItem[] }) {
  return (
    <CostDriverChart
      title="By Retainer Type"
      description="Median cost by retainer type"
      data={data}
    />
  )
}
