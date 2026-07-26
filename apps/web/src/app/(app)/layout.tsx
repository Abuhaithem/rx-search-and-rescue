import { redirect } from "next/navigation";
import { getProfile } from "@/server/queries/profile";
import { Shell } from "./_components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <Shell
      userName={profile.fullName}
      organizationName="Insurance Specialists Group"
      showAdminNav={profile.role !== "agent"}
    >
      {children}
    </Shell>
  );
}
