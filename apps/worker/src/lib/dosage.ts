/**
 * Pulls strength/form out of RxC dosage strings ("Eliquis TAB 2.5MG",
 * "diltiazem hydrochloride er (extended release beads) CAP 240MG/24").
 * Best-effort: nulls are fine, agents confirm on the intake review screen.
 */

export interface ParsedDosage {
  strength: string | null;
  form: string | null;
}

const FORM_RE =
  /\b(TABLETS?|TABS?|CAPSULES?|CAPS?|SOLUTION|SOLN|SOL|SUSPENSION|SUSP|INJECTION|INJ|CREAM|CRE|OINTMENT|OIN|SYRUP|SYP|PATCH|INHALER|INH|SPRAY|GEL|LOTION|LOT|DROPS|SUPPOSITORY|SUPP)\b/i;

const STRENGTH_RE =
  /(\d+(?:\.\d+)?\s*(?:MG|MCG|GM|G|ML|MEQ|UNITS?|%)(?:\/[0-9A-Z.%]+)?(?:\s*ER)?)/i;

export function parseDosageText(dosageText: string | null): ParsedDosage {
  if (!dosageText) return { strength: null, form: null };
  const formMatch = dosageText.match(FORM_RE);
  const strengthMatch = dosageText.match(STRENGTH_RE);
  return {
    strength: strengthMatch?.[1]?.trim() ?? null,
    form: formMatch?.[1]?.toLowerCase() ?? null,
  };
}
