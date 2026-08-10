"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface YearSwitcherProps {
  years: number[];
  value: number;
  basePath: string;
}

/** Plan-year picker fed from the DB (plans ∪ formularies) — never hardcoded. */
export function YearSwitcher({ years, value, basePath }: YearSwitcherProps) {
  const router = useRouter();
  return (
    <Select
      value={String(value)}
      onValueChange={(year) => router.push(`${basePath}?year=${year}`)}
    >
      <SelectTrigger className="w-28 text-data">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((year) => (
          <SelectItem key={year} value={String(year)} className="text-data">
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
