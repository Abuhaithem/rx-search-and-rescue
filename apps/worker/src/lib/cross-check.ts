/**
 * Deterministic cross-check of Claude's vision extraction against the PDF's
 * own text layer: drug-name token overlap + a rough row-count comparison.
 * On mismatch the page's rows are marked needsReview with lowered confidence
 * (the caller applies OK_CONFIDENCE / MISMATCH_CONFIDENCE).
 */
import type { FormularyRow } from "@rxsr/core/intake";

export const OK_CONFIDENCE = 0.9;
export const MISMATCH_CONFIDENCE = 0.5;

export interface CrossCheckResult {
  ok: boolean;
  /** Fraction of extracted rows whose name tokens appear in the text layer. */
  overlapRatio: number;
  matchedRows: number;
  /** 0 when the text layer has no usable line structure (check skipped). */
  estimatedTextRows: number;
}

const tokenize = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9. ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );

/**
 * Dose-form filler appears in nearly every row, so it cannot distinguish a
 * real row from a hallucinated one — dropped from the row side of the check.
 */
const FILLER_TOKENS = new Set([
  "oral",
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "solution",
  "suspension",
  "injection",
  "cream",
  "ointment",
  "extended",
  "release",
  "delayed",
  "chewable",
  "mg",
  "mcg",
  "ml",
  "hcl",
  "sodium",
  "potassium",
  "sulfate",
]);

const distinctiveRowTokens = (rawDrugName: string): string[] => {
  const all = [...tokenize(rawDrugName)];
  const distinctive = all.filter((t) => !FILLER_TOKENS.has(t));
  return distinctive.length > 0 ? distinctive : all;
};

function estimateRowCount(pageText: string): number {
  const lines = pageText.split("\n");
  // A joined single-line text layer carries no row structure — skip the check.
  if (lines.length < 3) return 0;
  return lines.filter(
    (line) => /[a-z]{3,}/i.test(line) && /(^|\s)[1-6](\s|$)/.test(line),
  ).length;
}

export function crossCheckFormularyPage(
  rows: FormularyRow[],
  pageText: string,
): CrossCheckResult {
  const textTokens = tokenize(pageText);

  let matchedRows = 0;
  for (const row of rows) {
    const rowTokens = distinctiveRowTokens(row.rawDrugName);
    if (rowTokens.length === 0) continue;
    const hits = rowTokens.filter((t) => textTokens.has(t)).length;
    if (hits / rowTokens.length >= 0.6) matchedRows += 1;
  }

  const overlapRatio = rows.length === 0 ? 1 : matchedRows / rows.length;
  const estimatedTextRows = estimateRowCount(pageText);
  const rowCountOk =
    estimatedTextRows === 0 ||
    Math.abs(rows.length - estimatedTextRows) <=
      Math.max(2, Math.ceil(estimatedTextRows * 0.25));

  return {
    ok: overlapRatio >= 0.8 && rowCountOk,
    overlapRatio,
    matchedRows,
    estimatedTextRows,
  };
}
