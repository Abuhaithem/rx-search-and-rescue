import type { Cents } from "@rxsr/core";

/** "$47.50" | "47.5" | "" → cents; null for blank; NaN for unparseable. */
export function parseDollarsToCents(value: string): Cents | null {
  const trimmed = value.trim().replace(/[$,\s]/g, "");
  if (trimmed === "") return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return Number.NaN;
  return Math.round(dollars * 100);
}

/** Cents → bare dollar string for an input value ("275", "47.50"). */
export function centsToDollarInput(cents: Cents | null): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
