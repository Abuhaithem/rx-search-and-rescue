import { redirect } from "next/navigation";
import { AppShell } from "@/components/domain/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { getProfile } from "@/server/queries/profile";

/** Admin surface gate: agents never see it — only admin | manager pass. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "agent") redirect("/dashboard");

  return (
    <AppShell
      userName={profile.fullName}
      organizationName="Insurance Specialists Group"
      showAdminNav
    >
      {children}
      <Toaster />
    </AppShell>
  );
}
