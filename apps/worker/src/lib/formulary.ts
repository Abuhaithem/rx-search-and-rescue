/**
 * Pure formulary row helpers: brand detection, normalization, and
 * multi-strength expansion ("... 15 mg, 30 mg, 60 mg" → one normalized name
 * per strength). Deterministic; exhaustively unit-tested.
 */

const UNIT = "(?:mg|mcg|g|gm|ml|meq|mEq|units?|%)";
// A strength segment: "30 mg", "60", "0.5 mg/ml", "100 units/ml"
const STRENGTH_SEGMENT_RE = new RegExp(
  `^\\d+(?:\\.\\d+)?(?:\\s*${UNIT}(?:\\/[a-z0-9.]+)?)?$`,
  "i",
);
const TRAILING_STRENGTH_WITH_UNIT_RE = new RegExp(
  `^(.*?)\\s+(\\d+(?:\\.\\d+)?\\s*${UNIT}(?:\\/[a-z0-9.]+)?)$`,
  "i",
);
const TRAILING_BARE_NUMBER_RE = /^(.*?)\s+(\d+(?:\.\d+)?)$/;
const UNIT_PART_RE = new RegExp(`${UNIT}(?:\\/[a-z0-9.]+)?$`, "i");

/** Formulary convention: brand rows are printed fully UPPERCASE. */
export function isBrandName(rawDrugName: string): boolean {
  const letters = rawDrugName.replace(/[^a-zA-Z]/g, "");
  return letters.length > 0 && letters === letters.toUpperCase();
}

export function normalizeDrugName(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

const unitOf = (segment: string): string | null => {
  const m = segment.match(UNIT_PART_RE);
  return m ? m[0] : null;
};

/**
 * Expands a multi-strength row into one normalized single-strength name per
 * strength. Rows without a strength list come back as a single normalized
 * name. Units are inherited right-to-left ("15, 30, 60 mg" → all mg).
 */
export function expandStrengths(rawDrugName: string): string[] {
  const normalized = normalizeDrugName(rawDrugName);
  const segments = normalized.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return [normalized];

  const [first, ...rest] = segments;
  if (first === undefined) return [normalized];
  if (!rest.every((s) => STRENGTH_SEGMENT_RE.test(s))) return [normalized];

  let base: string | undefined;
  let firstStrength: string | undefined;
  const withUnit = first.match(TRAILING_STRENGTH_WITH_UNIT_RE);
  if (withUnit && withUnit[1] !== undefined && withUnit[2] !== undefined) {
    base = withUnit[1];
    firstStrength = withUnit[2];
  } else if (rest.some((s) => unitOf(s) !== null)) {
    // "... tablet 15, 30, 60 mg": first strength is bare, unit comes later.
    const bare = first.match(TRAILING_BARE_NUMBER_RE);
    if (bare && bare[1] !== undefined && bare[2] !== undefined) {
      base = bare[1];
      firstStrength = bare[2];
    }
  }
  if (base === undefined || firstStrength === undefined) return [normalized];

  const strengths = [firstStrength, ...rest];
  let carriedUnit: string | null = null;
  for (let i = strengths.length - 1; i >= 0; i--) {
    const segment = strengths[i];
    if (segment === undefined) continue;
    const unit = unitOf(segment);
    if (unit !== null) carriedUnit = unit;
    else if (carriedUnit !== null) strengths[i] = `${segment} ${carriedUnit}`;
  }

  return strengths.map((s) => normalizeDrugName(`${base} ${s}`));
}
