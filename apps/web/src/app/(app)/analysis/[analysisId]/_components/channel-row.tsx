"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPricingChannel } from "@/server/actions/analysis";
import { toast } from "@/components/ui/sonner";
import { ChannelSwitcher, type ChannelValue } from "@/components/domain/channel-switcher";
import { cn } from "@/lib/utils";

interface ChannelRowProps {
  analysisId: string;
  value: ChannelValue;
  clientPharmacyName: string | null;
}

export function ChannelRow({ analysisId, value, clientPharmacyName }: ChannelRowProps) {
  const router = useRouter();
  const [current, setCurrent] = useState<ChannelValue>(value);
  const [pending, startTransition] = useTransition();

  const onChange = (next: ChannelValue) => {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setPricingChannel(analysisId, next === "client" ? null : next);
      if (!result.ok) {
        setCurrent(previous);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className={cn(pending && "pointer-events-none opacity-60")}>
      <ChannelSwitcher
        value={current}
        onChange={onChange}
        clientPharmacyName={clientPharmacyName ?? undefined}
      />
    </div>
  );
}
