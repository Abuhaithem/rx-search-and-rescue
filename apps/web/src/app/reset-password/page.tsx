import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { ResetPasswordForm } from "./_components/reset-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password — Rx Search & Rescue",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-deepwater px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-5 space-y-1">
            <h1 className="font-display text-lg font-bold text-deepwater">Reset password</h1>
            <p className="text-sm text-steel">
              Choose a new password. Every signed-in device will be signed out.
            </p>
          </div>
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <p className="rounded-card bg-fog px-4 py-3 text-sm text-steel">
              This page needs the link from your reset email. If yours has expired,{" "}
              <Link
                href="/forgot-password"
                className="font-semibold text-deepwater hover:underline"
              >
                request a new one
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
      <Toaster />
    </main>
  );
}
