export function formatCurrency(n: number | null | undefined): string {
  if (n == null) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatCurrencyDetailed(n: number | null | undefined): string {
  if (n == null) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null) return "0%"
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n)
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "0"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(n)
}

export function formatDuration(days: number | null | undefined): string {
  if (days == null) return "N/A"
  const months = days / 30.44
  if (months < 1) return `${Math.round(days)}d`
  return `${months.toFixed(1)}mo`
}
