import { Suspense } from "react"
import { createClient } from "@/lib/supabase/server"
import { fetchFilterOptions } from "@/lib/queries"
import { Sidebar } from "@/components/layout/Sidebar"
import { FilterBar } from "@/components/filters/FilterBar"

export const revalidate = 3600

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const t0 = Date.now()
  const filterOptions = await fetchFilterOptions(supabase)
  console.log(`[layout] fetched filter options in ${Date.now() - t0}ms`)

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-56 min-w-0 overflow-x-hidden">
        <div className="p-6 space-y-6 min-w-0">
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
