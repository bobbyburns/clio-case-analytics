"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function PricingModelError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[pricing-model] route error boundary:", error)
  }, [error])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing Model Analysis</h1>
      </div>
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-800">Something went wrong</h2>
        <p className="mt-2 text-sm text-rose-700 font-mono whitespace-pre-wrap">
          {error.name}: {error.message}
        </p>
        {error.digest && (
          <p className="mt-1 text-xs text-rose-600 font-mono">digest: {error.digest}</p>
        )}
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  )
}
