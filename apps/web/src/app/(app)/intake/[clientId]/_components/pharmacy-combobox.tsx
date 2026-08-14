"use client";

import { useRef, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  searchPharmacies,
  type PharmacySearchHit,
} from "@/server/actions/pharmacies";

export interface PharmacySelection {
  label: string;
  pharmacyId: string | null;
}

interface PharmacyComboboxProps {
  value: PharmacySelection;
  onChange: (selection: PharmacySelection) => void;
  invalid?: boolean;
  /** Client ZIP — search results are scoped to it when present. */
  clientZip?: string | null;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Searchable dropdown over the pharmacies table (NPPES-seeded). Picking a hit
 * links the client to a real pharmacies row; the free-text escape hatch keeps
 * the typed name with no link (surfaces amber until resolved).
 */
export function PharmacyCombobox({ value, onChange, invalid, clientZip }: PharmacyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PharmacySearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, startSearch] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (q: string) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setSearched(false);
      return;
    }
    debounce.current = setTimeout(() => {
      startSearch(async () => {
        const result = await searchPharmacies(trimmed, clientZip ?? null);
        if (result.ok) {
          setHits(result.data);
          setSearched(true);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
  };

  const pick = (selection: PharmacySelection) => {
    onChange(selection);
    setOpen(false);
    setQuery("");
    setHits([]);
    setSearched(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-72 justify-between font-normal",
            !value.label && "text-steel",
            invalid && "border-restricted bg-restricted-soft/40",
          )}
        >
          <span className="truncate">
            {value.label || "Search pharmacies…"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-steel" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="border-b border-mist/70 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Name, city, or ZIP — 2+ characters"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1">
          {searching ? (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-steel">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </li>
          ) : null}
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-fog"
                onClick={() => pick({ label: hit.name, pharmacyId: hit.id })}
              >
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    hit.id === value.pharmacyId ? "text-covered" : "invisible",
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-deepwater">
                    {hit.name}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-steel">
                    <MapPin className="size-3 shrink-0" />
                    {[hit.address1, hit.city, hit.state].filter(Boolean).join(", ")}
                    {hit.zip ? <span className="text-data"> {hit.zip}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {searched && !searching && hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-steel">No pharmacies found.</li>
          ) : null}
          {query.trim().length >= 2 && !searching ? (
            <li>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-steel hover:bg-fog"
                onClick={() => pick({ label: query.trim(), pharmacyId: null })}
              >
                Use “{query.trim()}” as typed (no match on file)
              </button>
            </li>
          ) : null}
          {value.label ? (
            <li>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-steel hover:bg-fog"
                onClick={() => pick({ label: "", pharmacyId: null })}
              >
                Clear pharmacy
              </button>
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
