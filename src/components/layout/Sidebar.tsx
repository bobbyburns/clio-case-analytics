"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  LayoutDashboard,
  DollarSign,
  TrendingUp,
  Clock,
  LineChart,
  Activity,
  Users,
  LogOut,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/cost-distribution", label: "Cost Distribution", icon: DollarSign },
  { href: "/cost-drivers", label: "Cost Drivers", icon: TrendingUp },
  { href: "/duration", label: "Duration", icon: Clock },
  { href: "/trends", label: "Trends", icon: LineChart },
  { href: "/activity-patterns", label: "Activity Patterns", icon: Activity },
  { href: "/attorneys", label: "Attorneys", icon: Users },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-56 border-r border-border bg-card flex flex-col">
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
        <div className="flex items-center justify-center size-7 rounded-md bg-blue-600 text-white">
          <BarChart3 className="size-4" />
        </div>
        <span className="font-semibold text-sm">Clio Analytics</span>
      </div>
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-border p-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="size-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
