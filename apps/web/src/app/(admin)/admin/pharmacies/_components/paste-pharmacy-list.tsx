"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClipboardPaste, Loader2, X } from "lucide-react";
import { importPharmacyList, type PharmacyImportRow } from "@/server/actions/pharmacies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface EditableRow {
  key: number;
  name: string;
  address1: string;
  city: string;
  zip: string;
}

const ZIP_RE = /^\d{5}$/;

/**
 * One pasted line → name / address / city / zip. Excel and Sheets paste as
 * tab-separated; a plain comma table falls back to comma with everything
 * between name and the trailing city+zip folded into the address.
 */
function parseLine(line: string): Omit<EditableRow, "key"> | null {
  const cells = (
    line.includes("\t") ? line.split("\t") : line.split(",")
  ).map((c) => c.trim());
  const nonEmpty = cells.filter((c) => c !== "");
  if (nonEmpty.length < 2) return null;
  const name = nonEmpty[0] ?? "";
  const rest = nonEmpty.slice(1);
  // ZIP is wherever the 5-digit token sits (usually last; "83702-1234" trims).
  let zipIndex = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (/^\d{5}(-\d{4})?$/.test(rest[i]!)) {
      zipIndex = i;
      break;
    }
  }
  const zip = zipIndex >= 0 ? rest[zipIndex]!.slice(0, 5) : "";
  const remaining = rest.filter((_, i) => i !== zipIndex);
  const city = remaining.length > 1 ? (remaining[remaining.length - 1] ?? "") : "";
  const address1 = remaining.slice(0, remaining.length > 1 ? -1 : undefined).join(", ");
  return { name, address1, city, zip };
}

const HEADER_RE = /pharmacy|address|city|zip|store/i;

export function PastePharmacyList() {
  const router = useRouter();
  const [state, setState] = useState("ID");
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const parse = () => {
    const lines = pasted.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const dataLines =
      lines.length > 0 && HEADER_RE.test(lines[0]!) && !/\d{5}/.test(lines[0]!)
        ? lines.slice(1)
        : lines;
    const parsed = dataLines
      .map(parseLine)
      .filter((r): r is Omit<EditableRow, "key"> => r !== null);
    if (parsed.length === 0) {
      toast.error("Nothing parseable — paste rows with at least a name and a ZIP");
      return;
    }
    setRows(parsed.map((r, i) => ({ ...r, key: nextKey + i })));
    setNextKey((k) => k + parsed.length);
  };

  const patch = (key: number, field: keyof Omit<EditableRow, "key">, value: string) =>
    setRows((previous) =>
      previous.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );

  const invalidCount = rows.filter((r) => r.name.trim().length < 2 || !ZIP_RE.test(r.zip)).length;

  const submit = () => {
    if (!/^[A-Za-z]{2}$/.test(state.trim())) {
      toast.error("State is the 2-letter code, e.g. ID");
      return;
    }
    const payload: PharmacyImportRow[] = rows
      .filter((r) => r.name.trim().length >= 2 && ZIP_RE.test(r.zip))
      .map((r) => ({
        name: r.name.trim(),
        address1: r.address1.trim() || null,
        city: r.city.trim() || null,
        zip: r.zip,
      }));
    if (payload.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    startTransition(async () => {
      const result = await importPharmacyList(state.trim().toUpperCase(), payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.inserted} pharmacies added, ${result.data.updated} updated`,
      );
      setRows([]);
      setPasted("");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-display text-base font-extrabold text-deepwater">
          Paste a pharmacy list
        </h2>
        <p className="text-sm text-steel">
          Columns: <span className="font-semibold">Pharmacy (store # if any) · Address · City ·
          ZIP</span> — copied straight from Excel or Sheets (tab-separated). Review and correct
          the rows below before importing; re-importing the same list updates addresses instead
          of duplicating.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-state">State</Label>
          <Input
            id="import-state"
            className="text-data w-16 uppercase"
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
          />
        </div>
        <div className="min-w-64 flex-1">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder={"Walgreens #5841\t1520 W State St\tBoise\t83702\nSav-Mor Drug\t216 SW 5th Ave\tMeridian\t83642"}
            className="font-mono text-xs"
          />
        </div>
        <Button type="button" variant="secondary" onClick={parse} disabled={pasted.trim() === ""}>
          <ClipboardPaste className="size-4" />
          Parse
        </Button>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="max-h-96 overflow-y-auto rounded-card border border-mist/60">
            <Table>
              <THead>
                <TRow>
                  <TH>Pharmacy</TH>
                  <TH>Address</TH>
                  <TH>City</TH>
                  <TH className="w-24">ZIP</TH>
                  <TH className="w-10" aria-label="Remove" />
                </TRow>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TRow key={row.key} className="hover:bg-transparent">
                    <TCell className="px-1.5 py-1">
                      <Input
                        aria-label="Pharmacy name"
                        className={cn("h-8", row.name.trim().length < 2 && "border-notcovered")}
                        value={row.name}
                        onChange={(e) => patch(row.key, "name", e.target.value)}
                      />
                    </TCell>
                    <TCell className="px-1.5 py-1">
                      <Input
                        aria-label="Address"
                        className="h-8"
                        value={row.address1}
                        onChange={(e) => patch(row.key, "address1", e.target.value)}
                      />
                    </TCell>
                    <TCell className="px-1.5 py-1">
                      <Input
                        aria-label="City"
                        className="h-8 w-36"
                        value={row.city}
                        onChange={(e) => patch(row.key, "city", e.target.value)}
                      />
                    </TCell>
                    <TCell className="px-1.5 py-1">
                      <Input
                        aria-label="ZIP"
                        inputMode="numeric"
                        className={cn("text-data h-8 w-20", !ZIP_RE.test(row.zip) && "border-notcovered")}
                        value={row.zip}
                        onChange={(e) => patch(row.key, "zip", e.target.value)}
                      />
                    </TCell>
                    <TCell className="px-1.5 py-1">
                      <button
                        type="button"
                        aria-label={`Remove ${row.name}`}
                        className="rounded-md p-1 text-steel hover:bg-notcovered-soft hover:text-notcovered"
                        onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                      >
                        <X className="size-3.5" />
                      </button>
                    </TCell>
                  </TRow>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={submit} disabled={pending || rows.length === invalidCount}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Import {(rows.length - invalidCount).toLocaleString()} pharmacies
            </Button>
            {invalidCount > 0 ? (
              <p className="text-xs text-notcovered">
                {invalidCount} row{invalidCount === 1 ? "" : "s"} skipped — needs a name and a
                5-digit ZIP.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
