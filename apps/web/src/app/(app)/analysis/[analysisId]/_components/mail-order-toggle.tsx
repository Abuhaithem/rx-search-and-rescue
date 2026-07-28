"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setIncludeMailOrder } from "@/server/actions/analysis";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/** Adds each plan's mail-order channel as a row in the cost matrix. */
export function MailOrderToggle({ analysisId, checked }: { analysisId: string; checked: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(checked);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const result = await setIncludeMailOrder(analysisId, next);
      if (!result.ok) {
        setOn(!next);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm text-deepwater",
        pending && "pointer-events-none opacity-60",
      )}
    >
      <Checkbox checked={on} onCheckedChange={(v) => toggle(v === true)} />
      Compare mail order (90-day)
    </label>
  );
}
