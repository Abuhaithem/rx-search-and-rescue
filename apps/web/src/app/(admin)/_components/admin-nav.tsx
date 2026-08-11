"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/carriers", label: "Carriers" },
  { href: "/admin/plans", label: "Plans" },
] as const;

/** Admin sub-nav. Carries ?year across tabs so the year in view is stable. */
export function AdminNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const year = searchParams.get("year");

  return (
    <nav aria-label="Admin sections" className="flex items-center gap-1 border-b border-mist/70 pb-3">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={year ? `${tab.href}?year=${year}` : tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "bg-deepwater text-white"
                : "text-steel hover:bg-mist/40 hover:text-deepwater",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
