"use client";

import { useState, useTransition } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { requestPasswordReset } from "@/server/actions/auth";

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [challengeAttempt, setChallengeAttempt] = useState(0);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const turnstileBlocking = turnstileSiteKey !== null && turnstileToken === null;

  if (sent) {
    return (
      <div className="flex items-start gap-3 rounded-card bg-fog px-4 py-3 text-sm text-deepwater">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-covered" />
        <p>
          If an account exists for <span className="font-semibold">{email}</span>, a reset link
          is in its inbox. The link works once and expires in 1 hour.
        </p>
      </div>
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await requestPasswordReset(email, turnstileToken ?? undefined);
      if (!result.ok) {
        toast.error(result.error);
        if (turnstileSiteKey) {
          setTurnstileToken(null);
          setChallengeAttempt((n) => n + 1);
        }
        return;
      }
      setSent(true);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {turnstileSiteKey ? (
        <TurnstileWidget
          key={challengeAttempt}
          siteKey={turnstileSiteKey}
          onToken={setTurnstileToken}
        />
      ) : null}
      <Button type="submit" disabled={isPending || turnstileBlocking} className="mt-1 w-full">
        {isPending ? (
          <>
            <Loader2 className="animate-spin" />
            Sending…
          </>
        ) : (
          "Email me a reset link"
        )}
      </Button>
    </form>
  );
}
