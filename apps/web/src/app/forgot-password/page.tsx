import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { turnstileSiteKey } from "@/server/turnstile";
import { ForgotPasswordForm } from "./_components/forgot-password-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forgot password — Rx Search & Rescue",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-deepwater px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-5 space-y-1">
            <h1 className="font-display text-lg font-bold text-deepwater">Forgot password</h1>
            <p className="text-sm text-steel">
              Enter your account email. If it exists, a one-hour reset link is on its way.
            </p>
          </div>
          <ForgotPasswordForm turnstileSiteKey={turnstileSiteKey()} />
          <p className="mt-4 text-center text-sm">
            <Link href="/login" className="font-semibold text-steel hover:text-deepwater">
              ← Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
      <Toaster />
    </main>
  );
}
