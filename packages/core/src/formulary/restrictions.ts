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

/**
 * Parser for QL-appendix prose ("Covered drugs with a quantity limit"
 * charts — UHC-style formularies keep amounts out of the main table):
 *   "Maximum of 2 tablets per day"
 *   "Maximum of 1 syringe (2.4 ml) per 56 days"
 *   "1 vaccination dose (0.5 ml) per day"
 * Conservative: only whole-number quantities parse; anything else returns
 * null and the verbatim text remains the only record.
 */
const QL_TEXT_RE =
  /(?:maximum\s+of\s+)?(?<![\d.])(\d[\d,]*)(?!\.\d)\s+[a-z][a-z\s./-]*?(?:\([^)]*\)\s*)?per\s+(?:(\d+)\s+)?days?\b/i;

export function parseQuantityLimitText(
  raw: string | null | undefined,
): { quantity: number; days: number } | null {
  if (!raw) return null;
  const m = raw.trim().match(QL_TEXT_RE);
  if (!m) return null;
  const quantity = Number(m[1]!.replace(/,/g, ""));
  const days = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(days) || days < 1) {
    return null;
  }
  return { quantity, days };
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
