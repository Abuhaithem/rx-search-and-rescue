import type { Cents } from "@rxsr/core";

/**
 * UI money formatting: whole-dollar amounts drop the decimals ($8, $340),
 * fractional amounts keep two ($47.50). Money is always integer cents.
 */
export function formatUsd(cents: Cents): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}
