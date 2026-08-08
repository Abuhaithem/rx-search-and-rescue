import Link from "next/link";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { cn } from "@/lib/utils";

/**
 * Deepwater app bar + fog workspace. Content is constrained to max-w-6xl per
 * the layout contract. Server-compatible: pass activeNav from the page.
 */

interface AppShellProps {
  userName: string;
  /** e.g. "Insurance Specialists Group" — shown after the user name. */
  organizationName?: string;
  activeNav?: "dashboard" | "admin";
  /** Admin nav is only rendered for admin/manager roles. */
  showAdminNav?: boolean;
  children: React.ReactNode;
  className?: string;
}

const navItems = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "admin", label: "Admin", href: "/admin" },
] as const;

function AppShell({
  userName,
  organizationName,
  activeNav,
  showAdminNav = false,
  children,
  className,
}: AppShellProps) {
  const visibleNavItems = navItems.filter((item) => item.key !== "admin" || showAdminNav);
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex min-h-screen flex-col bg-fog">
      <header className="sticky top-0 z-40 bg-deepwater text-white shadow-[0_2px_10px_-2px_rgb(14_29_47/0.4)]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-6">
          <Link
            href="/"
            className="rounded-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <LogoLockup />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {visibleNavItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={activeNav === item.key ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                  activeNav === item.key
                    ? "bg-harbor text-white shadow-inner"
                    : "text-white/65 hover:bg-harbor/60 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-semibold text-white">{userName}</div>
              {organizationName ? (
                <div className="text-[11px] text-white/55">{organizationName}</div>
              ) : null}
            </div>
            <div
              aria-hidden
              className="flex size-9 items-center justify-center rounded-full bg-harbor text-xs font-semibold text-white ring-1 ring-inset ring-white/15"
            >
              {initials || "·"}
            </div>
          </div>
        </div>
      </header>
      <main className={cn("mx-auto w-full max-w-6xl flex-1 px-6 py-8", className)}>{children}</main>
    </div>
  );
}

export { AppShell, type AppShellProps };
