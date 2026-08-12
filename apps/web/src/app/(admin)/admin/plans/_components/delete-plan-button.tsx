"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { TypeToConfirmDeleteDialog } from "@/components/domain/type-to-confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { deletePlan } from "@/server/actions/admin";

export function DeletePlanButton({ planId, planName }: { planId: string; planName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const result = await deletePlan(planId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan deleted");
      setOpen(false);
      router.push(`/admin/plans?year=${result.data.planYear}`);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="text-notcovered hover:bg-notcovered-soft hover:text-notcovered"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
        Delete plan
      </Button>
      <TypeToConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this plan?"
        confirmName={planName}
        pending={pending}
        onConfirm={remove}
      >
        <p>
          “{planName}” disappears from the catalog along with its premium, deductible, tier cost
          sharing, service areas, and its Summary of Benefits PDF (unless a sibling plan shares
          the file). If the plan is used in a client analysis, the delete is refused. This cannot
          be undone.
        </p>
      </TypeToConfirmDeleteDialog>
    </>
  );
}
