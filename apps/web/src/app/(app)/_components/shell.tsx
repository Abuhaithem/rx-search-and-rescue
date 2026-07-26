"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/domain/app-shell";
import { Toaster } from "@/components/ui/sonner";

interface ShellProps {
  userName: string;
  organizationName: string;
  showAdminNav?: boolean;
  children: React.ReactNode;
}

export function Shell({ userName, organizationName, showAdminNav = false, children }: ShellProps) {
  const pathname = usePathname();
  const activeNav = pathname.startsWith("/admin") ? "admin" : "dashboard";

  return (
    <>
      <AppShell
        userName={userName}
        organizationName={organizationName}
        activeNav={activeNav}
        showAdminNav={showAdminNav}
      >
        {children}
      </AppShell>
      <Toaster />
    </>
  );
}
