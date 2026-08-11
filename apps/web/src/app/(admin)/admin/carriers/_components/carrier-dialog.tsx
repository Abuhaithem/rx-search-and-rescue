"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import {
  createCarrier,
  deleteCarrier,
  removeCarrierLogo,
  renameCarrier,
  uploadCarrierLogo,
} from "@/server/actions/admin";
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
import { CarrierLogo } from "@/components/domain/carrier-logo";

interface CarrierDialogProps {
  /** Present = edit mode; absent = create mode. */
  carrier?: { id: string; name: string; logoUrl: string | null };
  trigger: React.ReactNode;
}

export function CarrierDialog({ carrier, trigger }: CarrierDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(carrier?.name ?? "");
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const logoForm = new FormData(event.currentTarget);
    const logoFile = logoForm.get("logo");
    const hasLogo = logoFile instanceof File && logoFile.size > 0;

    startTransition(async () => {
      const saved = carrier
        ? await renameCarrier(carrier.id, name)
        : await createCarrier(name);
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      if (hasLogo) {
        const logo = await uploadCarrierLogo(saved.data.carrierId, logoForm);
        if (!logo.ok) {
          toast.error(`Carrier saved, but the logo failed: ${logo.error}`);
        }
      }
      toast.success(carrier ? "Carrier updated" : `${name.trim()} created`);
      setOpen(false);
      if (!carrier) setName("");
      router.push(`/admin/carriers?carrier=${saved.data.carrierId}`);
      router.refresh();
    });
  };

  const removeCarrier = () => {
    if (!carrier) return;
    startTransition(async () => {
      const result = await deleteCarrier(carrier.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Carrier deleted");
      setOpen(false);
      router.push("/admin/carriers");
      router.refresh();
    });
  };

  const removeLogo = () => {
    if (!carrier) return;
    startTransition(async () => {
      const result = await removeCarrierLogo(carrier.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo removed");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{carrier ? "Edit carrier" : "New carrier"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="carrier-name">Carrier name</Label>
            <Input
              id="carrier-name"
              autoFocus
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Blue Cross of Idaho"
            />
            <p className="text-xs text-steel">
              Exactly as it should appear on plans and reports.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="carrier-logo">Logo</Label>
            <div className="flex items-center gap-3">
              {carrier ? <CarrierLogo name={carrier.name} logoUrl={carrier.logoUrl} size={40} /> : null}
              <Input
                id="carrier-logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="flex-1"
              />
            </div>
            <p className="text-xs text-steel">
              PNG, JPEG, WebP, or SVG — up to 2 MB. Square works best.
              {carrier?.logoUrl ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="font-semibold text-notcovered hover:underline"
                  >
                    Remove current logo
                  </button>
                </>
              ) : null}
            </p>
          </div>
          <Button type="submit" disabled={pending || name.trim().length < 2} className="w-full">
            {pending ? <Loader2 className="animate-spin" /> : null}
            {carrier ? "Save carrier" : "Create carrier"}
          </Button>
          {carrier ? (
            <button
              type="button"
              onClick={removeCarrier}
              disabled={pending}
              className="w-full text-center text-xs font-semibold text-notcovered hover:underline"
            >
              Delete this carrier (only possible while it has no plans or uploads)
            </button>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
