"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Destructive confirmation that only unlocks once the user retypes the
 * target's name — for deletes that take real data with them.
 */
export function TypeToConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  confirmName,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The exact name the user must retype (match is case-insensitive). */
  confirmName: string;
  pending: boolean;
  onConfirm: () => void;
  /** Consequence copy shown above the input. */
  children: React.ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const matches = normalize(typed) === normalize(confirmName);

  function handleOpenChange(next: boolean) {
    if (!next) setTyped("");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-steel">{children}</div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-delete-name">
              Type <span className="font-semibold text-deepwater">{confirmName}</span> to confirm
            </Label>
            <Input
              id="confirm-delete-name"
              autoComplete="off"
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || !matches}
            onClick={onConfirm}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
