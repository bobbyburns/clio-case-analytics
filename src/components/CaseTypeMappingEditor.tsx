"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Save, X, Check } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface Props {
  caseTypes: Array<{ case_type: string; count: number }>
  existingMappings: Array<{ id: number; raw_case_type: string; mapped_category: string }>
}

const SUGGESTED_CATEGORIES = [
  "Divorce",
  "Custody",
  "Child Support",
  "Post-Decree",
  "Guardianship",
  "OP (Order of Protection)",
  "Pre-Nup",
  "Real Estate",
  "Other Family",
  "Other",
]

export function CaseTypeMappingEditor({ caseTypes, existingMappings }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const em of existingMappings) {
      m[em.raw_case_type] = em.mapped_category
    }
    return m
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [filter, setFilter] = useState("")

  const setMapping = (raw: string, category: string) => {
    setMappings((prev) => ({ ...prev, [raw]: category }))
    setSaved(false)
  }

  const clearMapping = (raw: string) => {
    setMappings((prev) => {
      const next = { ...prev }
      delete next[raw]
      return next
    })
    setSaved(false)
  }

  const saveAll = async () => {
    setSaving(true)
    const supabase = createClient()

    // Delete all existing mappings
    await supabase.from("case_type_mappings").delete().neq("id", 0)

    // Insert all current mappings
    const rows = Object.entries(mappings).map(([raw, cat]) => ({
      raw_case_type: raw,
      mapped_category: cat,
    }))

    if (rows.length > 0) {
      await supabase.from("case_type_mappings").insert(rows)
    }

    // Update clio_matters.mapped_category based on mappings
    for (const [raw, cat] of Object.entries(mappings)) {
      await supabase
        .from("clio_matters")
        .update({ mapped_category: cat })
        .eq("case_type", raw)
    }

    // Clear mapped_category for unmapped types
    const mappedTypes = Object.keys(mappings)
    if (mappedTypes.length > 0) {
      // For types NOT in mappings, set mapped_category to null
      const { data: unmapped } = await supabase
        .from("clio_matters")
        .select("case_type")
        .not("case_type", "in", `(${mappedTypes.map((t) => `"${t}"`).join(",")})`)
        .limit(1)
      if (unmapped && unmapped.length > 0) {
        // There are unmapped types — bulk clear
        for (const ct of caseTypes) {
          if (!mappings[ct.case_type]) {
            await supabase
              .from("clio_matters")
              .update({ mapped_category: null })
              .eq("case_type", ct.case_type)
          }
        }
      }
    }

    setSaving(false)
    setSaved(true)
    startTransition(() => router.refresh())
  }

  const filtered = filter
    ? caseTypes.filter((ct) =>
        ct.case_type.toLowerCase().includes(filter.toLowerCase())
      )
    : caseTypes

  const mappedCount = Object.keys(mappings).length
  const totalTypes = caseTypes.length

  return (
    <div className="space-y-4">
      {/* Quick category buttons */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_CATEGORIES.map((cat) => (
              <Badge key={cat} variant="outline" className="text-sm">
                {cat}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Click a category below each case type, or type a custom one.
          </p>
        </CardContent>
      </Card>

      {/* Search and stats */}
      <div className="flex items-center gap-4">
        <Input
          placeholder="Search case types..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">
          {mappedCount}/{totalTypes} mapped
        </span>
        <div className="ml-auto flex items-center gap-2">
          {saved && (
            <span className="text-sm text-green-600 flex items-center gap-1">
              <Check className="size-4" /> Saved
            </span>
          )}
          <Button onClick={saveAll} disabled={saving}>
            <Save className="size-4 mr-1" />
            {saving ? "Saving..." : "Save All Mappings"}
          </Button>
        </div>
      </div>

      {/* Mapping table */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {filtered.map((ct) => (
              <div
                key={ct.case_type}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50"
              >
                <div className="min-w-[200px]">
                  <span className="font-medium text-sm">{ct.case_type}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({ct.count} cases)
                  </span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">→</span>
                  <Input
                    placeholder="Type category or click below..."
                    value={mappings[ct.case_type] ?? ""}
                    onChange={(e) => setMapping(ct.case_type, e.target.value)}
                    className="max-w-[200px] h-8 text-sm"
                  />
                  {mappings[ct.case_type] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => clearMapping(ct.case_type)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {SUGGESTED_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                        mappings[ct.case_type] === cat
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-input hover:bg-muted"
                      }`}
                      onClick={() => setMapping(ct.case_type, cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
