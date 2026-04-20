import type { HistogramBin } from "@/lib/types"

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  const weight = index - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

export function median(arr: number[]): number {
  return percentile(arr, 50)
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((sum, v) => sum + v, 0) / arr.length
}

export function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const squaredDiffs = arr.map((v) => (v - m) ** 2)
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (arr.length - 1))
}

/** Fixed-bucket histogram with meaningful dollar ranges. */
export function histogram(arr: number[], _bins: number = 20): HistogramBin[] {
  if (arr.length === 0) return []

  const BUCKETS = [
    [0, 1000, "<$1k"],
    [1000, 2500, "$1k–$2.5k"],
    [2500, 5000, "$2.5k–$5k"],
    [5000, 7500, "$5k–$7.5k"],
    [7500, 10000, "$7.5k–$10k"],
    [10000, 15000, "$10k–$15k"],
    [15000, 20000, "$15k–$20k"],
    [20000, 30000, "$20k–$30k"],
    [30000, 50000, "$30k–$50k"],
    [50000, 75000, "$50k–$75k"],
    [75000, 100000, "$75k–$100k"],
    [100000, Infinity, "$100k+"],
  ] as const

  const result: HistogramBin[] = BUCKETS.map(([lo, hi, label]) => ({
    binStart: lo,
    binEnd: hi === Infinity ? 999999999 : hi,
    label,
    count: 0,
  }))

  for (const value of arr) {
    for (let i = 0; i < BUCKETS.length; i++) {
      if (value >= BUCKETS[i][0] && value < BUCKETS[i][1]) {
        result[i].count++
        break
      }
    }
  }

  // Trim trailing empty buckets
  while (result.length > 1 && result[result.length - 1].count === 0) {
    result.pop()
  }

  return result
}

export function computeStats(arr: number[]) {
  return {
    count: arr.length,
    min: arr.length > 0 ? Math.min(...arr) : 0,
    max: arr.length > 0 ? Math.max(...arr) : 0,
    mean: mean(arr),
    median: median(arr),
    stdDev: stdDev(arr),
    p10: percentile(arr, 10),
    p25: percentile(arr, 25),
    p50: percentile(arr, 50),
    p75: percentile(arr, 75),
    p90: percentile(arr, 90),
  }
}
