"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { tidyPharmacyBrands } from "@/server/actions/pharmacies";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

/**
 * Kicks the worker's brand-tidy job: an LLM judges which brand-name variants
 * are the same chain and merges them. Display grouping only — identities,
 * networks, and client links never change, so it is safe to re-run anytime.
 */
export function TidyBrandsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const result = await tidyPharmacyBrands();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Brand tidy started — this page tracks the progress");
      router.refresh();
    });
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles className="size-4" />}
      AI-tidy brands
    </Button>
  );
}
