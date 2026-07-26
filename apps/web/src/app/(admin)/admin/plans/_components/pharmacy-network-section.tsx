"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/sonner";
import { attachPharmacyDirectory, setPlanPharmacyStatus } from "@/server/actions/admin";
import type { NetworkStatus } from "@rxsr/core";
import type { PharmacyZipRow } from "../../_lib/pharmacies";

const STATUS_OPTIONS: { value: NetworkStatus; label: string }[] = [
  { value: "preferred", label: "In network · Preferred" },
  { value: "standard", label: "In network · Standard" },
  { value: "out_of_network", label: "Not in network" },
];

export function PharmacyNetworkSection({
  planId,
  year,
  directoryAttached,
  zip,
  results,
}: {
  planId: string;
  year: number;
  directoryAttached: boolean;
  zip: string | null;
  results: PharmacyZipRow[];
}) {
  const router = useRouter();
  const [zipInput, setZipInput] = useState(zip ?? "");
  const [pendingPharmacyId, setPendingPharmacyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = zipInput.trim();
    if (!/^\d{5}$/.test(trimmed)) {
      toast.error("Enter a 5-digit ZIP code");
      return;
    }
    router.replace(`/admin/plans?year=${year}&plan=${planId}&pzip=${trimmed}`);
  }

  function handleSetStatus(pharmacyId: string, status: NetworkStatus) {
    setPendingPharmacyId(pharmacyId);
    startTransition(async () => {
      const result = await setPlanPharmacyStatus(planId, pharmacyId, status);
      setPendingPharmacyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="font-semibold text-deepwater">Pharmacy network list:</span>
          {directoryAttached ? (
            <span className="font-semibold text-covered">✓ attached</span>
          ) : (
            <span className="text-steel">not attached</span>
          )}
          <AttachDirectoryDialog planId={planId} directoryAttached={directoryAttached} />
        </div>
        <p className="text-xs text-steel">
          The carrier&apos;s pharmacy directory is what marks each client&apos;s pharmacy as
          preferred / standard / out of network on the comparison screens.
        </p>

        <Separator />

        <div className="space-y-3">
          <p className="text-eyebrow">Pharmacy status overrides</p>
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <Input
              inputMode="numeric"
              maxLength={5}
              placeholder="Search pharmacies by ZIP"
              className="text-data w-56"
              value={zipInput}
              onChange={(event) => setZipInput(event.target.value)}
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {zip == null ? null : results.length === 0 ? (
            <p className="text-sm text-steel">
              No pharmacies on file for <span className="text-data">{zip}</span> yet — they are
              added when client intakes or directories mention them.
            </p>
          ) : (
            <ul className="divide-y divide-mist/70">
              {results.map((pharmacy) => (
                <li key={pharmacy.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  <div className="min-w-48 flex-1">
                    <p className="text-sm font-semibold text-deepwater">{pharmacy.name}</p>
                    <p className="text-xs text-steel">
                      {[pharmacy.address1, pharmacy.city].filter(Boolean).join(", ")}
                      {pharmacy.zip ? (
                        <>
                          {" "}
                          · <span className="text-data">{pharmacy.zip}</span>
                        </>
                      ) : null}
                      {pharmacy.verifiedByName ? (
                        <> · Last verified by {pharmacy.verifiedByName}</>
                      ) : null}
                    </p>
                  </div>
                  {pharmacy.status ? (
                    <NetworkStatusChip status={pharmacy.status} />
                  ) : (
                    <span className="text-xs text-steel">No status</span>
                  )}
                  <Select
                    value={pharmacy.status ?? undefined}
                    onValueChange={(value) => handleSetStatus(pharmacy.id, value as NetworkStatus)}
                    disabled={pendingPharmacyId === pharmacy.id}
                  >
                    <SelectTrigger className="h-8 w-44 text-[13px]">
                      <SelectValue placeholder="Set status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AttachDirectoryDialog({
  planId,
  directoryAttached,
}: {
  planId: string;
  directoryAttached: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      toast.error("Attach the pharmacy directory PDF");
      return;
    }
    const formData = new FormData();
    formData.set("pdf", file);
    startTransition(async () => {
      const result = await attachPharmacyDirectory(planId, formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Directory attached — matching pharmacies now");
      setOpen(false);
      setFile(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          {directoryAttached ? "Replace directory PDF" : "Attach directory PDF"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {directoryAttached ? "Replace pharmacy directory" : "Attach pharmacy directory"}
          </DialogTitle>
          <DialogDescription>
            Upload the carrier&apos;s pharmacy network list PDF for this plan. Ingestion marks
            each known pharmacy preferred / standard / out of network.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="directory-pdf">Directory PDF</Label>
            <Input
              id="directory-pdf"
              type="file"
              accept="application/pdf,.pdf"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Uploading…" : "Attach directory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
