"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { resolveReviewRow } from "@/server/actions/admin";
import type { FormularyReviewRow } from "@/server/queries/formularies";

function readingSummary(row: FormularyReviewRow): string {
  const restrictions: string[] = [];
  if (row.pa) restrictions.push("PA");
  if (row.st) restrictions.push("ST");
  if (row.qlQuantity != null) {
    restrictions.push(`QL ${row.qlQuantity}/${row.qlDays ?? 30}d`);
  }
  restrictions.push(...row.extraFlags);
  return `Tier ${row.tier}${restrictions.length > 0 ? ` · ${restrictions.join(", ")}` : ""}`;
}

export function ReviewTable({ rows }: { rows: FormularyReviewRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FormularyReviewRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function resolve(row: FormularyReviewRow, action: "accept" | "remove") {
    setPendingId(row.id);
    startTransition(async () => {
      const result = await resolveReviewRow(row.id, { action });
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display text-base font-extrabold text-deepwater">
        Rows to review (<span className="text-data">{rows.length}</span>)
      </h2>

      {rows.length === 0 ? (
        <p className="rounded-card border border-mist/60 bg-white px-4 py-6 text-sm text-steel shadow-card">
          No rows need a human look — both readings agreed on every drug.
        </p>
      ) : (
        <div className="rounded-card border border-mist/60 bg-white shadow-card">
          <Table>
            <THead>
              <TRow>
                <TH className="w-20">Page</TH>
                <TH>Drug as printed</TH>
                <TH>Extracted reading</TH>
                <TH className="w-64">Decision</TH>
              </TRow>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TRow key={row.id}>
                  <TCell className="text-data whitespace-nowrap text-steel">
                    p. {row.sourcePage}
                  </TCell>
                  <TCell className="font-semibold">{row.rawDrugName}</TCell>
                  <TCell
                    className="text-data text-[13px]"
                    title={row.rawRequirementsText ?? undefined}
                  >
                    {readingSummary(row)}
                  </TCell>
                  <TCell>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pendingId === row.id}
                        onClick={() => resolve(row, "accept")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pendingId === row.id}
                        onClick={() => setEditing(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-notcovered hover:bg-notcovered-soft"
                        disabled={pendingId === row.id}
                        onClick={() => resolve(row, "remove")}
                      >
                        Remove
                      </Button>
                    </div>
                  </TCell>
                </TRow>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {editing ? (
        <EditReviewDialog
          key={editing.id}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function EditReviewDialog({
  row,
  onClose,
  onSaved,
}: {
  row: FormularyReviewRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tier, setTier] = useState(String(row.tier));
  const [pa, setPa] = useState(row.pa);
  const [st, setSt] = useState(row.st);
  const [qlQuantity, setQlQuantity] = useState(row.qlQuantity == null ? "" : String(row.qlQuantity));
  const [qlDays, setQlDays] = useState(row.qlDays == null ? "" : String(row.qlDays));
  const [flags, setFlags] = useState(row.extraFlags.join(", "));
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tierNumber = Number.parseInt(tier, 10);
    if (!Number.isInteger(tierNumber) || tierNumber < 1 || tierNumber > 6) {
      toast.error("Tier must be a number from 1 to 6");
      return;
    }
    const quantity = qlQuantity.trim() === "" ? null : Number.parseInt(qlQuantity, 10);
    const days = qlDays.trim() === "" ? null : Number.parseInt(qlDays, 10);
    if ((quantity != null && !(quantity > 0)) || (days != null && !(days > 0))) {
      toast.error("Quantity-limit values must be positive whole numbers");
      return;
    }
    startTransition(async () => {
      const result = await resolveReviewRow(row.id, {
        action: "edit",
        tier: tierNumber,
        pa,
        st,
        qlQuantity: quantity,
        qlDays: days,
        extraFlags: flags
          .split(",")
          .map((flag) => flag.trim())
          .filter((flag) => flag.length > 0),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit reading</DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-deepwater">{row.rawDrugName}</span> — p.{" "}
            {row.sourcePage}
            {row.rawRequirementsText ? ` · as printed: "${row.rawRequirementsText}"` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-tier">Tier</Label>
              <Input
                id="edit-tier"
                type="number"
                min={1}
                max={6}
                required
                className="text-data"
                value={tier}
                onChange={(event) => setTier(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-ql-quantity">QL quantity</Label>
              <Input
                id="edit-ql-quantity"
                type="number"
                min={1}
                className="text-data"
                value={qlQuantity}
                onChange={(event) => setQlQuantity(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-ql-days">QL days</Label>
              <Input
                id="edit-ql-days"
                type="number"
                min={1}
                className="text-data"
                value={qlDays}
                onChange={(event) => setQlDays(event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm font-semibold text-deepwater">
              <Checkbox checked={pa} onCheckedChange={(checked) => setPa(checked === true)} />
              Prior auth (PA)
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-deepwater">
              <Checkbox checked={st} onCheckedChange={(checked) => setSt(checked === true)} />
              Step therapy (ST)
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-flags">Extra flags</Label>
            <Input
              id="edit-flags"
              placeholder="Comma-separated, verbatim — e.g. NM, B/D PA"
              value={flags}
              onChange={(event) => setFlags(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save corrected reading"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
