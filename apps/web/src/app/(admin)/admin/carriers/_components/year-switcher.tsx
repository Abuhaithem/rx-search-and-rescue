"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";

interface YearSwitcherProps {
  years: number[];
  value: number;
  basePath: string;
}

const ADD_YEAR = "__add__";

/**
 * Plan-year picker fed from the DB (plans ∪ formularies) — never hardcoded.
 * "Add year" simply navigates to the new year: years exist by having data,
 * so the empty year renders its guided setup and the first upload creates it.
 */
export function YearSwitcher({ years, value, basePath }: YearSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newYear, setNewYear] = useState(String(Math.max(...years, value) + 1));

  const options = [...new Set([...years, value])].sort((a, b) => b - a);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const year = Number(newYear);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      toast.error("Enter a plan year between 2020 and 2100");
      return;
    }
    setOpen(false);
    if (options.includes(year)) {
      toast.info(`${year} already exists — switching to it`);
    }
    router.push(`${basePath}?year=${year}`);
  };

  return (
    <>
      <Select
        value={String(value)}
        onValueChange={(next) => {
          if (next === ADD_YEAR) {
            setOpen(true);
            return;
          }
          router.push(`${basePath}?year=${next}`);
        }}
      >
        <SelectTrigger className="w-32 text-data">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((year) => (
            <SelectItem key={year} value={String(year)} className="text-data">
              {year}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={ADD_YEAR}>
            <span className="flex items-center gap-1.5 font-semibold text-harbor">
              <Plus className="size-3.5" /> Add year…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add a plan year</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-plan-year">Plan year</Label>
              <Input
                id="new-plan-year"
                className="text-data"
                inputMode="numeric"
                autoFocus
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
              />
              <p className="text-xs text-steel">
                The year exists once its first formulary or plan is loaded — this opens its
                setup view.
              </p>
            </div>
            <Button type="submit" className="w-full">
              Open {newYear || "year"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
