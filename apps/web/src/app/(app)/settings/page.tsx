import { redirect } from "next/navigation";
import { getProfile } from "@/server/queries/profile";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/page-header";
import { DisplayNameForm, PasswordForm, ThemeToggle } from "./_components/settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" description="Your account and how the app looks." />

      <Card>
        <CardContent className="space-y-1 p-6">
          <p className="text-eyebrow">Profile</p>
          <div className="pt-2">
            <DisplayNameForm initialName={profile.fullName} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-6">
          <p className="text-eyebrow">Password</p>
          <p className="text-xs text-steel">
            Changing your password signs out every other device.
          </p>
          <div className="pt-3">
            <PasswordForm />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-6">
          <p className="text-eyebrow">Appearance</p>
          <p className="text-xs text-steel">
            Night mode restyles the app only — client-facing reports stay ink on paper.
          </p>
          <div className="pt-3">
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
