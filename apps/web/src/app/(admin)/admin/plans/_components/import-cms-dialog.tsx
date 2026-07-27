"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { importCmsData } from "@/server/actions/admin";

export function ImportCmsDialog({ defaultYear }: { defaultYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [planYear, setPlanYear] = useState(String(defaultYear));
  const [sourceUrl, setSourceUrl] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await importCmsData(Number(planYear), sourceUrl.trim());
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("CMS import started — network status and costs will fill in");
      setOpen(false);
      setSourceUrl("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <DownloadCloud />
          Import CMS data
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import CMS data</DialogTitle>
          <DialogDescription>
            Paste the download URL of the CMS Quarterly Prescription Drug Plan Formulary,
            Pharmacy Network, and Pricing Information file. The import fills each plan&apos;s
            pharmacy network status and prefills missing tier costs — your manual overrides
            and typed costs are never overwritten.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cms-year">Plan year</Label>
              <Input
                id="cms-year"
                type="number"
                min={2020}
                max={2100}
                required
                className="text-data"
                value={planYear}
                onChange={(event) => setPlanYear(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cms-url">CMS download URL</Label>
              <Input
                id="cms-url"
                type="url"
                required
                placeholder="https://www.cms.gov/…/quarterly-pdp-files.zip"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Starting…" : "Start import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
