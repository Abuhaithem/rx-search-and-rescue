"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { activateFormulary } from "@/server/actions/admin";

/** THE one rescue-orange action on screen 6: nothing goes live until this. */
export function ActivateFormularyButton({
  formularyId,
  year,
  disabled,
}: {
  formularyId: string;
  year: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="rescue"
      size="sm"
      disabled={disabled || isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await activateFormulary(formularyId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(`Formulary activated for ${year}`);
          router.refresh();
        })
      }
    >
      {isPending ? "Activating…" : `Activate for ${year}`}
    </Button>
  );
}
