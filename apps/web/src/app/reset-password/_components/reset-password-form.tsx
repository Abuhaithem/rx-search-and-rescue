"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { resetPassword } from "@/server/actions/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-card bg-fog px-4 py-3 text-sm text-deepwater">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-covered" />
          <p>Your password is updated. Sign in with it now.</p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 10) {
      toast.error("Password must be at least 10 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    startTransition(async () => {
      const result = await resetPassword(token, newPassword);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDone(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">New password</Label>
        <PasswordInput
          id="reset-password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={10}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <p className="text-xs text-steel">At least 10 characters.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password-confirm">Confirm new password</Label>
        <PasswordInput
          id="reset-password-confirm"
          autoComplete="new-password"
          required
          minLength={10}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={isPending} className="mt-1 w-full">
        {isPending ? (
          <>
            <Loader2 className="animate-spin" />
            Updating…
          </>
        ) : (
          "Set new password"
        )}
      </Button>
    </form>
  );
}
