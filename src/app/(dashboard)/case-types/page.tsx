import { createClient } from "@/lib/supabase/server"
import { CaseTypeMappingEditor } from "@/components/CaseTypeMappingEditor"

export default async function CaseTypesPage() {
  const supabase = await createClient()

  // Get all distinct raw case types with counts
  const allCaseTypes: Array<{ case_type: string; count: number }> = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from("clio_matters")
      .select("case_type")
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    for (const row of data) {
      if (!row.case_type) continue
      const existing = allCaseTypes.find((c) => c.case_type === row.case_type)
      if (existing) {
        existing.count++
      } else {
        allCaseTypes.push({ case_type: row.case_type, count: 1 })
      }
    }
    offset += data.length
    if (data.length < 1000) break
  }
  allCaseTypes.sort((a, b) => b.count - a.count)

  // Get existing mappings
  const { data: mappings } = await supabase
    .from("case_type_mappings")
    .select("*")
    .order("raw_case_type")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Case Type Mapping</h1>
        <p className="text-muted-foreground mt-1">
          Map raw Clio case types to normalized categories for better analysis.
          Changes apply to all reports immediately.
        </p>
      </div>

      <CaseTypeMappingEditor
        caseTypes={allCaseTypes}
        existingMappings={(mappings ?? []) as Array<{ id: number; raw_case_type: string; mapped_category: string }>}
      />
    </div>
  )
}
