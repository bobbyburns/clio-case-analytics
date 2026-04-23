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
  Cell,
  ReferenceLine,
  AreaChart,
  Area,
} from "recharts"
import { ChartCard } from "./ChartCard"

const BLUE = "#2563eb"
const EMERALD = "#059669"
const AMBER = "#d97706"
const ROSE = "#e11d48"
const SLATE = "#64748b"
const STACK_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#e11d48",
  "#0ea5e9",
  "#a16207",
  "#94a3b8",
]

interface WinnersLosersDatum {
  label: string
  count: number
  sign: "loss" | "gain" | "neutral"
}

export function WinnersLosersHistogram({
  data,
  description,
}: {
  data: WinnersLosersDatum[]
  description: string
}) {
  return (
    <ChartCard title="Per-Matter Revenue Delta Distribution" description={description}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" fontSize={10} tick={{ fill: SLATE }} angle={-25} textAnchor="end" height={60} />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) => [`${value} matters`, "Count"]}
            />
            <ReferenceLine x="$0 to $1k" stroke={SLATE} strokeDasharray="3 3" />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.sign === "loss" ? ROSE : d.sign === "gain" ? EMERALD : SLATE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

interface DensityDatum {
  label: string
  count: number
}

export function RevenueDensityHistogram({
  data,
  retainer,
}: {
  data: DensityDatum[]
  retainer: number
}) {
  // Find which bucket contains the current retainer
  const retainerLabel = findBucketLabelForRetainer(data, retainer)

  return (
    <ChartCard
      title="Monthly Revenue Density per Matter"
      description="Distribution of total_billable ÷ active_months. Dashed line marks the current retainer."
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" fontSize={10} tick={{ fill: SLATE }} angle={-25} textAnchor="end" height={60} />
            <YAxis fontSize={11} tick={{ fill: SLATE }} />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) => [`${value} matters`, "Count"]}
            />
            {retainerLabel && (
              <ReferenceLine
                x={retainerLabel}
                stroke={AMBER}
                strokeDasharray="3 3"
                label={{ value: `$${retainer}/mo`, position: "top", fontSize: 10, fill: AMBER }}
              />
            )}
            <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function findBucketLabelForRetainer(
  data: DensityDatum[],
  retainer: number,
): string | null {
  // Buckets are: <$250, $250–$500, $500–$1k, $1k–$1.5k, $1.5k–$2k, $2k–$2.5k,
  // $2.5k–$3.5k, $3.5k–$5k, $5k–$7.5k, $7.5k–$10k, $10k+
  const ranges: Array<[number, number, string]> = [
    [0, 250, "<$250"],
    [250, 500, "$250–$500"],
    [500, 1000, "$500–$1k"],
    [1000, 1500, "$1k–$1.5k"],
    [1500, 2000, "$1.5k–$2k"],
    [2000, 2500, "$2k–$2.5k"],
    [2500, 3500, "$2.5k–$3.5k"],
    [3500, 5000, "$3.5k–$5k"],
    [5000, 7500, "$5k–$7.5k"],
    [7500, 10000, "$7.5k–$10k"],
    [10000, Number.POSITIVE_INFINITY, "$10k+"],
  ]
  for (const [lo, hi, label] of ranges) {
    if (retainer >= lo && retainer < hi) {
      return data.some((d) => d.label === label) ? label : null
    }
  }
  return null
}

interface CategoryDatum {
  category: string
  matterCount: number
  medianDensity: number
  p25Density: number
  p75Density: number
}

export function BreakEvenByCaseTypeChart({
  data,
  retainer,
}: {
  data: CategoryDatum[]
  retainer: number
}) {
  const shown = data.slice(0, 12)
  return (
    <ChartCard
      title="Break-Even Retainer by Case Type"
      description="Median monthly revenue density per case type. Dashed line = current retainer. Case types above the line are losing money at this retainer; below the line are gaining."
    >
      <div className="h-96">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={shown}
            layout="vertical"
            margin={{ top: 4, right: 24, left: 24, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
            />
            <YAxis
              type="category"
              dataKey="category"
              fontSize={11}
              tick={{ fill: SLATE }}
              width={140}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value, name) => [
                `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`,
                name,
              ]}
              labelFormatter={(label) => `Case type: ${label}`}
            />
            <ReferenceLine
              x={retainer}
              stroke={AMBER}
              strokeDasharray="3 3"
              label={{ value: `$${retainer}`, position: "top", fontSize: 10, fill: AMBER }}
            />
            <Bar dataKey="medianDensity" name="Median $/mo" fill={BLUE} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

export function ClientMonthlyRevenueArea({
  data,
  clientKeys,
}: {
  data: Array<Record<string, string | number>>
  clientKeys: string[]
}) {
  return (
    <ChartCard
      title="Monthly Billable Revenue — Top Clients"
      description="Top 10 clients by lifetime billable revenue, plus all others rolled into 'Other'."
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" fontSize={10} tick={{ fill: SLATE }} />
            <YAxis
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) =>
                `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {clientKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="1"
                stroke={STACK_COLORS[i % STACK_COLORS.length]}
                fill={STACK_COLORS[i % STACK_COLORS.length]}
                fillOpacity={0.7}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

interface PredictabilityDatum {
  month: string
  hourly: number
  scenario: number
}

export function PredictabilityLineChart({ data }: { data: PredictabilityDatum[] }) {
  return (
    <ChartCard
      title="Monthly Revenue: Hourly vs. Retainer Scenario"
      description="Month-by-month comparison. The scenario line's flatness is the smoothing benefit."
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" fontSize={10} tick={{ fill: SLATE }} />
            <YAxis
              fontSize={11}
              tick={{ fill: SLATE }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              formatter={(value) =>
                `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="hourly" stroke={BLUE} strokeWidth={2} dot={false} name="Actual (Hourly)" />
            <Line type="monotone" dataKey="scenario" stroke={EMERALD} strokeWidth={2} dot={false} name="Scenario (Retainer)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}
