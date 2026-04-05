'use client'

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/budget", label: "Budget", icon: Wallet },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="p-6">
        <h1 className="text-lg font-bold tracking-tight">Sekisyo</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
