import type { Metadata } from "next";
import { LogoMark } from "@/components/brand/logo-mark";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Sign in — Rx Search & Rescue",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-deepwater px-6 py-16">
      {/* Stacked lockup per Brand Identity cover: mark, wordmark, mono tagline. */}
      <div className="flex flex-col items-center gap-6 text-white">
        <LogoMark size={72} title="Rx Search & Rescue" />
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="font-display text-2xl font-black uppercase leading-none tracking-[0.18em]">
            Rx Search <span className="text-rescue">&amp;</span> Rescue
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/60">
            Find every drug. Rescue every plan choice.
          </span>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <LoginForm />
        </CardContent>
      </Card>

      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
        Insurance Specialists Group
      </p>
      <Toaster />
    </main>
  );
}
