"use client";
import { DatasetSwitcher } from "./dataset-switcher";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth-client";
import { Action } from "@/components/record-ui";
const routes = [
  ["Records", "/dashboard"],
  ["Entities", "/dashboard/entities"],
  ["Arrangements", "/dashboard/arrangements"],
  ["Types & templates", "/dashboard/arrangements/types"],
  ["Events", "/dashboard/events"],
  ["Measurements", "/dashboard/measurements"],
  ["Tags", "/dashboard/tags"],
  ["Finance", "/dashboard/finance"],
  ["Charts & accounts", "/dashboard/finance/accounts"],
  ["Journal entries", "/dashboard/finance/entries"],
  ["Reports", "/dashboard/finance/reports"],
  ["Obligations", "/dashboard/finance/obligations"],
  ["Planning", "/dashboard/planning"],
  ["Trash", "/dashboard/trash"],
  ["Datasets", "/dashboard/datasets"],
];
export function Sidebar() {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto bg-secondary p-5">
      <Link
        href="/dashboard"
        className="px-3 text-2xl font-bold tracking-tight"
      >
        LifeOR2
      </Link>
      <DatasetSwitcher />
      <nav aria-label="Main navigation" className="flex-1 space-y-1">
        {routes.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring",
              pathname === href
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Action
        onClick={async () => {
          await signOut();
          window.location.assign("/login");
        }}
      >
        Sign out
      </Action>
    </div>
  );
}
