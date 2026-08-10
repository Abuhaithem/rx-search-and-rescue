"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { createCarrier, renameCarrier } from "@/server/actions/admin";
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

interface CarrierDialogProps {
  /** Present = rename mode; absent = create mode. */
  carrier?: { id: string; name: string };
  trigger: React.ReactNode;
}

export function CarrierDialog({ carrier, trigger }: CarrierDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(carrier?.name ?? "");
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = carrier
        ? await renameCarrier(carrier.id, name)
        : await createCarrier(name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(carrier ? "Carrier renamed" : `${name.trim()} created`);
      setOpen(false);
      if (!carrier) setName("");
      router.push(`/admin/carriers?carrier=${result.data.carrierId}`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{carrier ? "Rename carrier" : "New carrier"}</DialogTitle>
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
          <Button type="submit" disabled={pending || name.trim().length < 2} className="w-full">
            {pending ? <Loader2 className="animate-spin" /> : null}
            {carrier ? "Save name" : "Create carrier"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
