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

export function histogram(arr: number[], bins: number = 20): HistogramBin[] {
  if (arr.length === 0) return []
  const sorted = [...arr].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  if (min === max) {
    return [{ binStart: min, binEnd: max, label: `${min}`, count: arr.length }]
  }
  const binWidth = (max - min) / bins
  const result: HistogramBin[] = []
  for (let i = 0; i < bins; i++) {
    const binStart = min + i * binWidth
    const binEnd = i === bins - 1 ? max + 0.01 : min + (i + 1) * binWidth
    result.push({
      binStart,
      binEnd,
      label: `${Math.round(binStart)}`,
      count: 0,
    })
  }
  for (const value of sorted) {
    const binIndex = Math.min(Math.floor((value - min) / binWidth), bins - 1)
    result[binIndex].count++
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
