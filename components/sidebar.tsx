"use client";
import { DatasetSwitcher } from "./dataset-switcher";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Action } from "@/components/record-ui";
import {
  Aperture,
  BookOpen,
  Users,
  Network,
  Shapes,
  CalendarDays,
  Ruler,
  Tags,
  Wallet,
  Landmark,
  List,
  ChartNoAxesCombined,
  HandCoins,
  Telescope,
  Trash2,
  Database,
  type LucideIcon,
} from "lucide-react";
import "@/components/records.css";
const groups: { label: string; routes: [string, string, LucideIcon][] }[] = [
  {
    label: "Explore",
    routes: [
      ["Observatory", "/dashboard/insights", Aperture],
      ["Records overview", "/dashboard", BookOpen],
    ],
  },
  {
    label: "Life & relationships",
    routes: [
      ["Entities", "/dashboard/entities", Users],
      ["Arrangements", "/dashboard/arrangements", Network],
      ["Types & templates", "/dashboard/arrangements/types", Shapes],
      ["Events", "/dashboard/events", CalendarDays],
      ["Measurements", "/dashboard/measurements", Ruler],
      ["Tags & projects", "/dashboard/tags", Tags],
    ],
  },
  {
    label: "Money & planning",
    routes: [
      ["Finance overview", "/dashboard/finance", Wallet],
      ["Charts & accounts", "/dashboard/finance/accounts", Landmark],
      ["Journal entries", "/dashboard/finance/entries", List],
      ["Reports", "/dashboard/finance/reports", ChartNoAxesCombined],
      ["Obligations", "/dashboard/finance/obligations", HandCoins],
      ["Planning", "/dashboard/planning", Telescope],
    ],
  },
  {
    label: "Workspace",
    routes: [
      ["Trash", "/dashboard/trash", Trash2],
      ["Datasets", "/dashboard/datasets", Database],
    ],
  },
];
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  return (
    <div className="app-sidebar">
      <Link href="/dashboard" className="app-brand">
        <Aperture size={25} strokeWidth={1.25} />
        <span>
          LifeOR<span className="app-brand-number">2</span>
        </span>
      </Link>
      <DatasetSwitcher />
      <nav aria-label="Main navigation">
        {groups.map((group) => (
          <div className="app-nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.routes.map(([label, href, Icon]) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
              >
                <Icon size={16} strokeWidth={1.5} />
                <span>{label}</span>
                {pathname === href && <i />}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="app-account" aria-label="Signed-in account">
        <span>{session?.user.email}</span>
        <Action
          onClick={async () => {
            await signOut();
            window.location.assign("/login");
          }}
        >
          Sign out
        </Action>
      </div>
    </div>
  );
}
