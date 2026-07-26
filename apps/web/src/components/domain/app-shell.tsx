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
  return (
    <div className="flex min-h-screen flex-col bg-fog">
      <header className="bg-deepwater text-white">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-8 px-6">
          <Link
            href="/"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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
                    ? "bg-harbor text-white"
                    : "text-white/70 hover:bg-harbor/60 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto text-sm text-white/80">
            <span className="font-semibold text-white">{userName}</span>
            {organizationName ? <span> · {organizationName}</span> : null}
          </div>
        </div>
      </header>
      <main className={cn("mx-auto w-full max-w-6xl flex-1 px-6 py-8", className)}>{children}</main>
    </div>
  );
}

export { AppShell, type AppShellProps };
