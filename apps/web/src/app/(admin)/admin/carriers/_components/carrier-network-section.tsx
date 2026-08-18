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
import {
  attachCarrierDirectory,
  clearCarrierPharmacyNetwork,
  copyCarrierNetworkFromPreviousYear,
  setCarrierPharmacyStatus,
} from "@/server/actions/admin";
import { TypeToConfirmDeleteDialog } from "@/components/domain/type-to-confirm-delete-dialog";
import type { NetworkStatus } from "@rxsr/core";
import { fileTooLarge, MAX_PDF_BYTES } from "@/lib/file-limits";
import type { DirectoryJobStatus, PharmacyZipRow } from "../../_lib/pharmacies";

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
  carrierName,
  year,
  networkCount,
  previousYearNetworkCount = 0,
  zip,
  results,
  job,
}: {
  carrierId: string;
  carrierName: string;
  year: number;
  networkCount: number;
  /** Rows on last year's network — offered as a carry-over seed when this year is empty. */
  previousYearNetworkCount?: number;
  zip: string | null;
  results: PharmacyZipRow[];
  job: DirectoryJobStatus | null;
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
          <div className="ml-auto flex items-center gap-1.5">
            {networkCount > 0 ? (
              <ClearNetworkButton
                carrierId={carrierId}
                carrierName={carrierName}
                planYear={year}
                networkCount={networkCount}
              />
            ) : null}
            {networkCount === 0 && previousYearNetworkCount > 0 ? (
              <CopyPreviousYearButton
                carrierId={carrierId}
                planYear={year}
                previousYearNetworkCount={previousYearNetworkCount}
              />
            ) : null}
            <AttachDirectoryDialog carrierId={carrierId} planYear={year} hasNetwork={networkCount > 0} />
          </div>
        </div>
        {job?.status === "running" || job?.status === "queued" ? (
          <p className="rounded-card bg-fog px-3 py-2 text-sm text-deepwater">
            <span className="font-semibold">Reading the directory…</span>{" "}
            {job.message ?? "queued"} — this page refreshes itself.
          </p>
        ) : job?.status === "failed" ? (
          <p className="rounded-card bg-notcovered-soft px-3 py-2 text-sm text-notcovered">
            <span className="font-semibold">Directory import failed:</span>{" "}
            {job.error ?? "unknown error"}. Upload the PDF again to retry.
          </p>
        ) : null}
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

function CopyPreviousYearButton({
  carrierId,
  planYear,
  previousYearNetworkCount,
}: {
  carrierId: string;
  planYear: number;
  previousYearNetworkCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const copy = () => {
    startTransition(async () => {
      const result = await copyCarrierNetworkFromPreviousYear(carrierId, planYear);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.copied.toLocaleString()} pharmacies carried over from ${result.data.fromYear}`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Copy {planYear - 1} network
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Carry the {planYear - 1} network into {planYear}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-steel">
            All{" "}
            <span className="text-data font-semibold">
              {previousYearNetworkCount.toLocaleString()}
            </span>{" "}
            pharmacy statuses from {planYear - 1} are copied as a starting point, marked
            &ldquo;carryover&rdquo;. Uploading the {planYear} directory later overwrites them,
            and any status you set by hand outranks them — nothing is treated as verified.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={copy} disabled={pending}>
              {pending ? "Copying…" : `Copy ${previousYearNetworkCount.toLocaleString()} rows`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClearNetworkButton({
  carrierId,
  carrierName,
  planYear,
  networkCount,
}: {
  carrierId: string;
  carrierName: string;
  planYear: number;
  networkCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const clear = () => {
    startTransition(async () => {
      const result = await clearCarrierPharmacyNetwork(carrierId, planYear);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Network cleared — ${result.data.carrierRows.toLocaleString()} carrier rows and ${result.data.planRows.toLocaleString()} plan exceptions removed`,
      );
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
        className="text-notcovered hover:bg-notcovered-soft hover:text-notcovered"
        onClick={() => setOpen(true)}
      >
        Clear network
      </Button>
      <TypeToConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title={`Clear ${carrierName}'s ${planYear} pharmacy network?`}
        confirmName={carrierName}
        pending={pending}
        onConfirm={clear}
      >
        <p>
          All <span className="text-data font-semibold">{networkCount.toLocaleString()}</span>{" "}
          network rows for {planYear} will be removed — imported AND agent-verified statuses,
          plus any per-plan exceptions. The pharmacies themselves stay in the master list.
          Rebuild by re-uploading a directory or setting statuses in the ZIP search.
        </p>
      </TypeToConfirmDeleteDialog>
    </>
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
    const sizeError = fileTooLarge(file, MAX_PDF_BYTES);
    if (sizeError) {
      toast.error(sizeError);
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
