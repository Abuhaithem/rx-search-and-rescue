"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteClientAnalysis } from "@/server/actions/analysis";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";

export function DeleteAnalysisButton({
  analysisId,
  clientName,
}: {
  analysisId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const result = await deleteClientAnalysis(analysisId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${clientName} deleted`);
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
        aria-label={`Delete ${clientName}`}
        className="text-steel hover:text-notcovered"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete {clientName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-steel">
            This permanently erases the client record — medications, pharmacy
            selections, the comparison, and any generated reports. The uploaded
            Rx Collect PDF is removed from storage. This cannot be undone.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
              Delete client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
