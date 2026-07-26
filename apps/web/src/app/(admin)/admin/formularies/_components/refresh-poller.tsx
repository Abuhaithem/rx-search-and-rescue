"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls router.refresh() while an ingestion is running (PHI-safe: no realtime). */
export function RefreshPoller({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
