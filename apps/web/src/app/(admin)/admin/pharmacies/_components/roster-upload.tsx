"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { uploadPharmacyRoster } from "@/server/actions/pharmacies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

export function RosterUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState("ID");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!/^[A-Za-z]{2}$/.test(state.trim())) {
      toast.error("State must be the 2-letter code, e.g. ID");
      return;
    }
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose the roster PDF first");
      return;
    }
    const formData = new FormData();
    formData.set("pdf", file);
    startTransition(async () => {
      const result = await uploadPharmacyRoster(state, formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Roster processing started — this page tracks the progress");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-display text-base font-extrabold text-deepwater">
          Upload a roster PDF
        </h2>
        <p className="text-sm text-steel">
          A statewide pharmacy roster/directory PDF. Active locations are read out at ingestion
          (AI-extracted, defunct sections skipped) and land in the master list with their brand —
          re-uploading an updated roster refreshes addresses instead of duplicating.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-state">State</Label>
          <Input
            id="roster-state"
            className="text-data w-16 uppercase"
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-pdf">Roster PDF</Label>
          <Input id="roster-pdf" ref={fileRef} type="file" accept="application/pdf" />
        </div>
        <Button type="button" variant="secondary" onClick={submit} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <FileUp className="size-4" />}
          Upload &amp; extract
        </Button>
      </div>
    </div>
  );
}
