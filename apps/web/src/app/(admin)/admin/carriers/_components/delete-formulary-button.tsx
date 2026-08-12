"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteFormulary } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";

export function DeleteFormularyButton({
  formularyId,
  label,
}: {
  formularyId: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const result = await deleteFormulary(formularyId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Drug plan deleted");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Delete ${label}`}
        className="text-notcovered hover:text-notcovered"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this drug plan?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-steel">
            “{label}” will be deleted entirely: the extracted drug list, its linked plans with
            their cost sharing, and the stored PDFs (formulary and Summaries of Benefits). If a
            plan is already used in a client analysis, the delete is refused until those analyses
            are removed. This cannot be undone.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
