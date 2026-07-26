"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface QueueFiltersProps {
  search: string;
  /** "all" | AnalysisStatus */
  status: string;
  year: number | null;
  years: number[];
}

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "in_review", label: "In Review" },
  { value: "approved", label: "Approved" },
  { value: "delivered", label: "Delivered" },
];

export function QueueFilters({ search, status, year, years }: QueueFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(search);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  const setParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}${next.size > 0 ? `?${next.toString()}` : ""}`);
  };

  const onSearchChange = (value: string) => {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParams({ q: value.trim() || null }), 300);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        value={query}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search client…"
        aria-label="Search client"
        className="w-64"
      />
      <Tabs value={status || "all"} onValueChange={(value) => setParams({ status: value === "all" ? null : value })}>
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Select
        value={year === null ? "all" : String(year)}
        onValueChange={(value) => setParams({ year: value === "all" ? null : value })}
      >
        <SelectTrigger className="w-40" aria-label="Plan year">
          <SelectValue placeholder="Plan year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All plan years</SelectItem>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              Plan year: {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
