/**
 * Deterministic pre-filter that decides whether a formulary page is worth an
 * extraction call. Cost optimization only — the extractor already returns
 * zero rows for non-table pages; skipping just avoids paying for the call.
 *
 * CONSERVATIVE BY DESIGN: a wrongly skipped table page loses rows silently,
 * a wrongly extracted index page wastes ~a cent. Anything ambiguous (and any
 * page with no usable text layer) is extracted.
 */

export type PageClass = "extract" | "skip";

const TABLE_HEADER =
  /drug\s*name|drug\s*tier|requirements?\s*\/?\s*limits|covered\s+drugs/i;

/** QL (120 per 30 days), PA, ST, B/D — restriction notation only tables use. */
const RESTRICTION = /\b(?:QL|PA|ST|B\/D|NM|LA)\s*\(|\b(?:PA|ST);/;

const DOSAGE = /\d+(?:\.\d+)?\s*(?:mg|mcg|ml|gm?|%|units?|iu|hr|mEq)\b/gi;

/** Index rows: "letrozole..................16" or "LENVIMA (8 MG) 16". */
const DOTTED_LEADER = /\.{3,}\s*\d{1,3}\s*$/;
const TRAILING_PAGE_REF = /[a-z)]\s?\.{0,2}\s*\d{1,3}\s*$/i;

export function classifyFormularyPage(pageText: string): PageClass {
  const text = pageText.trim();
  // No text layer (scanned/image page) — cannot judge, must extract.
  if (text.length < 40) return "extract";

  if (TABLE_HEADER.test(text)) return "extract";
  if (RESTRICTION.test(text)) return "extract";

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const dottedLeaders = lines.filter((l) => DOTTED_LEADER.test(l)).length;
  const trailingRefs = lines.filter((l) => TRAILING_PAGE_REF.test(l)).length;
  // Dotted leaders are unambiguous index/TOC formatting; bare trailing page
  // numbers need a higher bar because table rows can end in digits too.
  if (dottedLeaders >= 8) return "skip";
  if (trailingRefs >= 15 && trailingRefs >= lines.length * 0.6) return "skip";

  const dosageTokens = text.match(DOSAGE)?.length ?? 0;
  if (dosageTokens >= 3) return "extract";

  // Prose front/back matter: long wrapped sentences, no dosage or table
  // signals anywhere. Table pages read as short column fragments.
  const averageLineLength =
    lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
  if (dosageTokens === 0 && averageLineLength > 55 && lines.length >= 5) {
    return "skip";
  }

  return "extract";
}
