import { redirect } from "next/navigation";
import { getProfile } from "@/server/queries/profile";
import { AppShell } from "@/components/domain/app-shell";
import { Toaster } from "@/components/ui/sonner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <AppShell
      userName={profile.fullName}
      organizationName="Insurance Specialists Group"
      showAdminNav={profile.role !== "agent"}
    >
      {children}
      <Toaster />
    </AppShell>
  );
}
