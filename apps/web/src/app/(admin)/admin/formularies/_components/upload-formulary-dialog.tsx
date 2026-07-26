"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { uploadFormulary } from "@/server/actions/admin";
import type { CarrierOption } from "../../_lib/carriers";

const NEW_CARRIER = "__new__";

export function UploadFormularyDialog({
  carriers,
  defaultYear,
}: {
  carriers: CarrierOption[];
  defaultYear: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [carrierChoice, setCarrierChoice] = useState(carriers.length > 0 ? "" : NEW_CARRIER);
  const [newCarrier, setNewCarrier] = useState("");
  const [planYear, setPlanYear] = useState(String(defaultYear));
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const carrierName = carrierChoice === NEW_CARRIER ? newCarrier.trim() : carrierChoice;
    if (!carrierName) {
      toast.error("Pick a carrier for this formulary");
      return;
    }
    if (!file) {
      toast.error("Attach the formulary PDF");
      return;
    }
    const formData = new FormData();
    formData.set("carrier", carrierName);
    formData.set("planYear", planYear);
    formData.set("label", label.trim());
    formData.set("pdf", file);

    startTransition(async () => {
      const result = await uploadFormulary(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Formulary uploaded — reading every page now");
      setOpen(false);
      setLabel("");
      setFile(null);
      router.push(
        `/admin/formularies?year=${planYear}&formulary=${result.data.formularyId}`,
      );
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload />
          Upload formulary PDF
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload formulary PDF</DialogTitle>
          <DialogDescription>
            The system reads every drug into its database and double-checks itself against the
            document&apos;s own index. Nothing goes live until you click Activate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Carrier</Label>
            {carriers.length > 0 ? (
              <Select value={carrierChoice} onValueChange={setCarrierChoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a carrier" />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((carrier) => (
                    <SelectItem key={carrier.id} value={carrier.name}>
                      {carrier.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CARRIER}>New carrier…</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {carrierChoice === NEW_CARRIER ? (
              <Input
                placeholder="Carrier name, e.g. Blue Cross of Idaho"
                value={newCarrier}
                onChange={(event) => setNewCarrier(event.target.value)}
              />
            ) : null}
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="formulary-year">Plan year</Label>
              <Input
                id="formulary-year"
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
              <Label htmlFor="formulary-label">Label</Label>
              <Input
                id="formulary-label"
                required
                placeholder="e.g. 2027 True Blue Rx (all True Blue plans)"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="formulary-pdf">Formulary PDF</Label>
            <Input
              id="formulary-pdf"
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
              {isPending ? "Uploading…" : "Upload & start check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
