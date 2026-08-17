/**
 * Drug-name resolution primitives: coverage documents and client forms carry
 * brand names ("Zetia"), the formulary index is keyed on generics
 * ("ezetimibe"). These pure helpers power the deterministic steps of the
 * resolution ladder (exact → alias → fuzzy); the LLM fallback lives in the
 * worker. Deterministic: same input, same output, always.
 */

/**
 * Tokens that describe the product, not the molecule: dosage forms, routes,
 * release modifiers, and package words. Strengths/numbers are stripped by
 * pattern.
 */
const NON_MOLECULE_TOKENS = new Set([
  "tab",
  "tabs",
  "tablet",
  "tablets",
  "cap",
  "caps",
  "capsule",
  "capsules",
  "sol",
  "soln",
  "solution",
  "susp",
  "suspension",
  "syrup",
  "cream",
  "ointment",
  "gel",
  "lotion",
  "patch",
  "film",
  "spray",
  "drops",
  "inj",
  "injection",
  "injectable",
  "vial",
  "pen",
  "syringe",
  "inhaler",
  "inhalation",
  "nebulizer",
  "suppository",
  "oral",
  "topical",
  "external",
  "ophthalmic",
  "otic",
  "nasal",
  "subcutaneous",
  "intramuscular",
  "transdermal",
  "sublingual",
  "buccal",
  "rectal",
  "vaginal",
  "er",
  "xr",
  "xl",
  "sr",
  "dr",
  "ir",
  "extended",
  "delayed",
  "immediate",
  "release",
  "daily",
  "weekly",
  "monthly",
  "hour",
  "hours",
  "hcl",
  "hbr",
  "sodium",
  "potassium",
  "calcium",
  "sulfate",
  "tartrate",
  "citrate",
  "maleate",
  "fumarate",
  "succinate",
  "besylate",
  "mesylate",
  "acetate",
  "chloride",
  "dihydrate",
  "monohydrate",
]);

/** "25 mg", "0.5mg/ml", "100 units/ml", bare numbers, percentages. */
const STRENGTH_RE = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|gm|ml|meq|units?|iu|hr|%)?(?:\s*\/\s*[a-z0-9.]+)?\b/gi;

/**
 * Raw drug text → the molecule key used across the resolution ladder:
 * lowercase, punctuation to spaces, strengths and dosage/route/form/salt
 * tokens removed. "Zetia TAB 10MG" → "zetia";
 * "ezetimibe-simvastatin oral tablet 10-20 mg" → "ezetimibe simvastatin".
 */
export function normalizeDrugKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(STRENGTH_RE, " ")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 1 && !NON_MOLECULE_TOKENS.has(token))
    .join(" ")
    .trim();
}

/** Bounded edit distance (insert/delete/substitute), early-exit above max. */
export function editDistanceWithin(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (current[j]! < rowMin) rowMin = current[j]!;
    }
    if (rowMin > max) return null;
    for (let j = 0; j <= b.length; j++) previous[j] = current[j]!;
  }
  return previous[b.length]! <= max ? previous[b.length]! : null;
}

/** Typo budget by length: short names get 1 edit, longer get 2. */
export const fuzzyBudget = (key: string): number => (key.length <= 6 ? 1 : 2);

/**
 * Typo-tolerant match of a normalized key against the generic index.
 * Returns the generic only when exactly ONE candidate sits at the minimum
 * distance within budget — ambiguity is a miss, never a guess.
 */
export function fuzzyResolveGeneric(
  key: string,
  genericKeys: Iterable<string>,
): string | null {
  if (key.length < 4) return null; // too short to fuzzy-match safely
  const max = fuzzyBudget(key);
  let best: { generic: string; distance: number } | null = null;
  let tied = false;
  for (const candidate of genericKeys) {
    const distance = editDistanceWithin(key, candidate, max);
    if (distance === null || distance === 0) continue; // 0 = exact, handled upstream
    if (best === null || distance < best.distance) {
      best = { generic: candidate, distance };
      tied = false;
    } else if (distance === best.distance && candidate !== best.generic) {
      tied = true;
    }
  }
  return best !== null && !tied ? best.generic : null;
}
