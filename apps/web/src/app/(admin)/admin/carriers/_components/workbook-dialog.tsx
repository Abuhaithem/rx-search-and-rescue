"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { importCarrierWorkbook } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { fileTooLarge, MAX_XLSX_BYTES } from "@/lib/file-limits";

interface WorkbookDialogProps {
  carrierId: string;
  carrierName: string;
  planYear: number;
}

export function WorkbookDialog({ carrierId, carrierName, planYear }: WorkbookDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const sizeError = fileTooLarge(formData.get("xlsx") as File | null, MAX_XLSX_BYTES);
    if (sizeError) {
      toast.error(sizeError);
      return;
    }
    startTransition(async () => {
      const result = await importCarrierWorkbook(carrierId, planYear, formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Workbook queued — tier costs and pharmacy network are importing");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <FileSpreadsheet className="size-4" /> Import workbook
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Import {carrierName} workbook — {planYear}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workbook-file">Carrier workbook (.xlsx)</Label>
            <Input id="workbook-file" name="xlsx" type="file" accept=".xlsx" required />
            <p className="text-xs text-steel">
              Reads the “Tier Pricing by Plan” and “Pharmacy Network” tabs. Plans must exist
              first (matched by name); plans that already have tier costs keep them, and
              agent-set pharmacy statuses always win.
            </p>
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? <Loader2 className="animate-spin" /> : null}
            Import
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
