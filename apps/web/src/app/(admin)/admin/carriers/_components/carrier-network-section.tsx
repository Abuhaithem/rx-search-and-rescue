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
import { attachCarrierDirectory, setCarrierPharmacyStatus } from "@/server/actions/admin";
import type { NetworkStatus } from "@rxsr/core";
import type { PharmacyZipRow } from "../../_lib/pharmacies";

const STATUS_OPTIONS: { value: NetworkStatus; label: string }[] = [
  { value: "preferred", label: "In network · Preferred" },
  { value: "standard", label: "In network · Standard" },
  { value: "out_of_network", label: "Not in network" },
];

/**
 * THE carrier's pharmacy network — one per carrier, covering every plan.
 * Directory upload feeds it; the ZIP search sets agent-verified statuses that
 * outrank any import.
 */
export function CarrierNetworkSection({
  carrierId,
  year,
  networkCount,
  zip,
  results,
}: {
  carrierId: string;
  year: number;
  networkCount: number;
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
    router.replace(`/admin/carriers?year=${year}&carrier=${carrierId}&zip=${trimmed}`);
  }

  function handleSetStatus(pharmacyId: string, status: NetworkStatus) {
    setPendingPharmacyId(pharmacyId);
    startTransition(async () => {
      const result = await setCarrierPharmacyStatus(carrierId, year, pharmacyId, status);
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-eyebrow">Pharmacy network</p>
          <span className="text-data text-xs text-steel">
            {networkCount.toLocaleString()} pharmacies on file for {year} — shared by every plan
            of this carrier
          </span>
          <div className="ml-auto">
            <AttachDirectoryDialog carrierId={carrierId} planYear={year} hasNetwork={networkCount > 0} />
          </div>
        </div>
        <p className="text-xs text-steel">
          One network per carrier: the directory (or workbook) marks each pharmacy preferred /
          standard / out of network for all plans at once. Statuses you set here are
          agent-verified and never overwritten by imports.
        </p>

        <Separator />

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <Input
            inputMode="numeric"
            maxLength={5}
            placeholder="Check or set a pharmacy by ZIP"
            className="text-data w-64"
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
      </CardContent>
    </Card>
  );
}

function AttachDirectoryDialog({
  carrierId,
  planYear,
  hasNetwork,
}: {
  carrierId: string;
  planYear: number;
  hasNetwork: boolean;
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
      const result = await attachCarrierDirectory(carrierId, planYear, formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Directory queued — the carrier network is updating");
      setOpen(false);
      setFile(null);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          {hasNetwork ? "Replace directory PDF" : "Upload directory PDF"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasNetwork ? "Replace pharmacy directory" : "Upload pharmacy directory"}
          </DialogTitle>
          <DialogDescription>
            The carrier&apos;s pharmacy network list PDF. Ingestion marks each pharmacy
            preferred / standard / out of network — once, for all of this carrier&apos;s plans.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="carrier-directory-pdf">Directory PDF</Label>
            <Input
              id="carrier-directory-pdf"
              type="file"
              accept="application/pdf,.pdf"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
