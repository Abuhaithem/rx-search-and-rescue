/**
 * Deterministic parser for the CMS formulary "Requirements/Limits" grammar.
 * Input examples (verbatim from carrier PDFs):
 *   "PA; QL (240 per 30 days); NEDS"
 *   "B/D PA; NM"
 *   "ST"
 *   "—"  /  ""  /  null
 *
 * Design rules (Discovery doc §3.2):
 *  - PA / ST are boolean flags. "B/D PA" is a distinct compound flag and must
 *    NOT set `pa` — it is preserved in extraFlags as "B/D PA".
 *  - QL is structured: quantity + period days. Period variants seen: 30, 28,
 *    5, 180 — parse any integer.
 *  - Every token we don't recognize is preserved VERBATIM in extraFlags,
 *    resolved against the formulary's own legend at display time.
 */

export interface ParsedRestrictions {
  pa: boolean;
  st: boolean;
  ql: { quantity: number; days: number } | null;
  extraFlags: string[];
}

const QL_RE = /^QL\s*\(\s*([\d,]+)\s*per\s*(\d+)\s*days?\s*\)$/i;

export function parseRestrictions(raw: string | null | undefined): ParsedRestrictions {
  const out: ParsedRestrictions = { pa: false, st: false, ql: null, extraFlags: [] };
  if (!raw) return out;
  const cleaned = raw.trim();
  if (cleaned === "" || cleaned === "—" || cleaned === "-") return out;

  for (const tokenRaw of cleaned.split(";")) {
    const token = tokenRaw.trim();
    if (token === "") continue;
    if (/^PA$/i.test(token)) {
      out.pa = true;
    } else if (/^ST$/i.test(token)) {
      out.st = true;
    } else if (QL_RE.test(token)) {
      const m = token.match(QL_RE)!;
      out.ql = { quantity: Number(m[1]!.replace(/,/g, "")), days: Number(m[2]) };
    } else {
      out.extraFlags.push(token);
    }
  }
  return out;
}

/** Render back to the canonical display string used in provenance popovers. */
export function formatRestrictions(r: ParsedRestrictions): string {
  const parts: string[] = [];
  if (r.pa) parts.push("PA");
  if (r.st) parts.push("ST");
  if (r.ql) parts.push(`QL (${r.ql.quantity} per ${r.ql.days} days)`);
  parts.push(...r.extraFlags);
  return parts.length ? parts.join("; ") : "—";
}
