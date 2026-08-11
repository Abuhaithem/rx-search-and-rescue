"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { cn } from "@/lib/utils";

/**
 * THE app header — one bar shared by every signed-in screen. Deepwater ink,
 * flat role-aware navigation (no sub-nav rows): agents see Dashboard, admins
 * additionally see Carriers and Plans. Active state derives from the path;
 * the avatar is the door to /settings. Content constrained to max-w-6xl per
 * the layout contract.
 */

interface AppShellProps {
  userName: string;
  /** e.g. "Insurance Specialists Group" — shown under the user name. */
  organizationName?: string;
  /** Admin nav items render only for admin/manager roles. */
  showAdminNav?: boolean;
  children: React.ReactNode;
  className?: string;
}

interface NavItem {
  label: string;
  href: string;
  /** Path prefixes that mark this item active. */
  match: string[];
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", match: ["/dashboard", "/intake", "/analysis"] },
  { label: "Carriers", href: "/admin/carriers", match: ["/admin/carriers", "/admin/formularies"], adminOnly: true },
  { label: "Plans", href: "/admin/plans", match: ["/admin/plans"], adminOnly: true },
];

function AppShell({
  userName,
  organizationName,
  showAdminNav = false,
  children,
  className,
}: AppShellProps) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || showAdminNav);
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex min-h-screen flex-col bg-fog">
      <header className="sticky top-0 z-40 bg-deepwater text-white shadow-[0_2px_10px_-2px_rgb(0_0_0/0.35)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-6">
          <Link
            href="/dashboard"
            className="rounded-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <LogoLockup />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {items.map((item) => {
              const active = item.match.some((prefix) => pathname.startsWith(prefix));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                    active
                      ? "bg-harbor text-white shadow-inner"
                      : "text-white/65 hover:bg-harbor/60 hover:text-white",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-semibold text-white">{userName}</div>
              {organizationName ? (
                <div className="text-[11px] text-white/55">{organizationName}</div>
              ) : null}
            </div>
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="flex size-9 items-center justify-center rounded-full bg-harbor text-xs font-semibold text-white ring-1 ring-inset ring-white/15 transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {initials || "·"}
            </Link>
          </div>
        </div>
      </header>
      <main className={cn("mx-auto w-full max-w-6xl flex-1 px-6 py-8", className)}>{children}</main>
    </div>
  );
}

export { AppShell, type AppShellProps };
