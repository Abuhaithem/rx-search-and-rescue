"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/domain/app-shell";
import { Toaster } from "@/components/ui/sonner";

interface ShellProps {
  userName: string;
  organizationName: string;
  children: React.ReactNode;
}

export function Shell({ userName, organizationName, children }: ShellProps) {
  const pathname = usePathname();
  const activeNav = pathname.startsWith("/admin") ? "admin" : "dashboard";

  return (
    <>
      <AppShell userName={userName} organizationName={organizationName} activeNav={activeNav}>
        {children}
      </AppShell>
      <Toaster />
    </>
  );
}
