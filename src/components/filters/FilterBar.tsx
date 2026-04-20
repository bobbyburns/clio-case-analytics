"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useCallback, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { X } from "lucide-react"

interface FilterBarProps {
  statuses: string[]
  caseTypes: string[]
  counties: string[]
  attorneys: string[]
}

export function FilterBar({ statuses, caseTypes, counties, attorneys }: FilterBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const getSelected = (key: string): string[] => {
    const val = searchParams.get(key)
    return val ? val.split(",").filter(Boolean) : []
  }

  const updateParam = useCallback(
    (key: string, values: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (values.length > 0) {
        params.set(key, values.join(","))
      } else {
        params.delete(key)
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    },
    [searchParams, pathname, router]
  )

  const updateDateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    },
    [searchParams, pathname, router]
  )

  const clearAll = useCallback(() => {
    startTransition(() => {
      router.push(pathname)
    })
  }, [pathname, router])

  const hasFilters = searchParams.toString().length > 0

  return (
    <div className={`flex flex-wrap items-end gap-3 p-4 bg-card rounded-xl ring-1 ring-foreground/10 ${isPending ? "opacity-70" : ""}`}>
      <MultiSelect
        label="Status"
        options={statuses}
        selected={getSelected("status")}
        onChange={(v) => updateParam("status", v)}
      />
      <MultiSelect
        label="Case Type"
        options={caseTypes}
        selected={getSelected("caseType")}
        onChange={(v) => updateParam("caseType", v)}
      />
      <MultiSelect
        label="County"
        options={counties}
        selected={getSelected("county")}
        onChange={(v) => updateParam("county", v)}
      />
      <MultiSelect
        label="Attorney"
        options={attorneys}
        selected={getSelected("attorney")}
        onChange={(v) => updateParam("attorney", v)}
      />
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input
          type="date"
          className="w-36 h-8"
          value={searchParams.get("dateFrom") ?? ""}
          onChange={(e) => updateDateParam("dateFrom", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input
          type="date"
          className="w-36 h-8"
          value={searchParams.get("dateTo") ?? ""}
          onChange={(e) => updateDateParam("dateTo", e.target.value)}
        />
      </div>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  )
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const toggleOption = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((s) => s !== opt))
    } else {
      onChange([...selected, opt])
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <select
          multiple
          value={selected}
          onChange={(e) => {
            const values = Array.from(e.target.selectedOptions, (o) => o.value)
            onChange(values)
          }}
          className="hidden"
        />
        <div className="relative group">
          <button
            type="button"
            className="flex items-center gap-1 h-8 px-2.5 text-sm rounded-lg border border-input bg-transparent hover:bg-muted transition-colors"
            onClick={(e) => {
              const menu = e.currentTarget.nextElementSibling
              if (menu) menu.classList.toggle("hidden")
            }}
          >
            <span className="text-muted-foreground">
              {selected.length === 0 ? `All ${label}` : `${selected.length} selected`}
            </span>
          </button>
          <div className="hidden absolute z-50 top-full left-0 mt-1 w-56 max-h-60 overflow-y-auto bg-popover rounded-lg shadow-md ring-1 ring-foreground/10 p-1">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent ${
                  selected.includes(opt) ? "bg-accent font-medium" : ""
                }`}
                onClick={() => toggleOption(opt)}
              >
                <span
                  className={`flex size-4 items-center justify-center rounded border ${
                    selected.includes(opt) ? "bg-blue-600 border-blue-600 text-white" : "border-input"
                  }`}
                >
                  {selected.includes(opt) && (
                    <svg className="size-3" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{opt}</span>
              </button>
            ))}
            {options.length === 0 && (
              <span className="block px-2 py-1.5 text-sm text-muted-foreground">No options</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
