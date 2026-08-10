import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/domain/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getProfile } from "@/server/queries/profile";
import { AdminNav } from "./_components/admin-nav";

/** Admin surface gate: agents never see it — only admin | manager pass. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "agent") redirect("/dashboard");

  return (
    <AppShell userName={profile.fullName} activeNav="admin" showAdminNav>
      <div className="space-y-6">
        {/* useSearchParams in AdminNav needs a Suspense boundary at build. */}
        <Suspense fallback={<div className="h-11" />}>
          <AdminNav />
        </Suspense>
        {children}
      </div>
      <Toaster />
    </AppShell>
  );
}
