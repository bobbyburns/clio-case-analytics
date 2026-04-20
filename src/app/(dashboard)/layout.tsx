import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { fetchFilterOptions } from "@/lib/queries"
import { Sidebar } from "@/components/layout/Sidebar"
import { FilterBar } from "@/components/filters/FilterBar"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const filterOptions = await fetchFilterOptions(supabase)

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56">
        <div className="p-6 space-y-6">
          <Suspense fallback={null}>
            <FilterBar
              statuses={filterOptions.statuses}
              caseTypes={filterOptions.caseTypes}
              counties={filterOptions.counties}
              attorneys={filterOptions.attorneys}
            />
          </Suspense>
          {children}
        </div>
      </main>
    </div>
  )
}
