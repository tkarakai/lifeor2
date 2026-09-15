"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  FileText,
  Calendar,
  DollarSign,
  BarChart3,
  TrendingUp,
  LogOut,
} from "lucide-react";

const routes = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
  },
  {
    label: "Entities",
    icon: Users,
    href: "/dashboard/entities",
  },
  {
    label: "Arrangements",
    icon: FileText,
    href: "/dashboard/arrangements",
  },
  {
    label: "Events",
    icon: Calendar,
    href: "/dashboard/events",
  },
  {
    label: "Finance",
    icon: DollarSign,
    href: "/dashboard/finance",
    children: [
      { label: "Accounts", href: "/dashboard/finance/accounts" },
      { label: "Entries", href: "/dashboard/finance/entries" },
      { label: "Reports", href: "/dashboard/finance/reports" },
      { label: "Reconciliation", href: "/dashboard/finance/reconciliation" },
    ],
  },
  {
    label: "Forecast",
    icon: TrendingUp,
    href: "/dashboard/forecast",
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="space-y-4 py-4 flex flex-col h-full bg-secondary">
      <div className="px-3 py-2 flex-1">
        <Link href="/dashboard" className="flex items-center pl-3 mb-14">
          <h1 className="text-2xl font-bold">
            LifeOR<span className="text-primary">2</span>
          </h1>
        </Link>
        <div className="space-y-1">
          {routes.map((route) => (
            <div key={route.href}>
              <Link
                href={route.href}
                className={cn(
                  "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-primary hover:bg-primary/10 rounded-lg transition",
                  pathname === route.href
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground"
                )}
              >
                <div className="flex items-center flex-1">
                  <route.icon className={cn("h-5 w-5 mr-3")} />
                  {route.label}
                </div>
              </Link>
              {route.children && pathname.startsWith(route.href) && (
                <div className="ml-8 mt-1 space-y-1">
                  {route.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cn(
                        "text-sm group flex p-2 w-full justify-start font-medium cursor-pointer hover:text-primary hover:bg-primary/10 rounded-lg transition",
                        pathname === child.href
                          ? "text-primary bg-primary/10"
                          : "text-muted-foreground"
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 py-2">
        <button className="text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-destructive hover:bg-destructive/10 rounded-lg transition text-muted-foreground">
          <LogOut className={cn("h-5 w-5 mr-3")} />
          Logout
        </button>
      </div>
    </div>
  );
}
