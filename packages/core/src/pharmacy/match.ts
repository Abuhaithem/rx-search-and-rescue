/**
 * Deterministic pharmacy candidate scoring. Pure, no I/O.
 * Weights are chosen so that (zip exact + name exact) = 0.85 =
 * PHARMACY_CONFIRM_THRESHOLD: anything short of both must be agent-confirmed.
 */
import type {
  ParsedPharmacyText,
  PharmacyCandidate,
  PharmacyMatch,
} from "./contracts";

const W_NAME = 0.5;
const W_ZIP = 0.35;
const W_STREET = 0.15;

/** Corporate/legal suffixes and generic pharmacy words carry no identity. */
const NOISE_WORDS = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "pllc",
  "pc",
  "the",
  "of",
  "and",
  "pharmacy",
  "pharmacies",
  "rx",
]);

// Apostrophes are removed (not spaced) so "Ridley's" tokenizes as "ridleys".
const normalizeTokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .filter(Boolean);

/** Identity tokens (ordered): noise words and bare store numbers removed. */
const orderedCoreTokens = (s: string): string[] =>
  normalizeTokens(s).filter((t) => !NOISE_WORDS.has(t) && !/^\d+$/.test(t));

const coreTokens = (s: string): Set<string> => new Set(orderedCoreTokens(s));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function nameSimilarity(a: string, b: string): number {
  // Compound-word equivalence: "The Drug Store" ≡ "THE DRUGSTORE" — compare
  // the space-squashed identity tokens before any token-set math.
  const squashA = orderedCoreTokens(a).join("");
  const squashB = orderedCoreTokens(b).join("");
  if (squashA !== "" && squashA === squashB) return 1;

  const coreA = coreTokens(a);
  const coreB = coreTokens(b);
  if (coreA.size > 0 && coreB.size > 0) return jaccard(coreA, coreB);
  // Names made entirely of noise words ("The Drug Store") fall back to the
  // full token sets so they can still match each other.
  return jaccard(new Set(normalizeTokens(a)), new Set(normalizeTokens(b)));
}

const streetNumber = (street: string | null): string | null => {
  if (!street) return null;
  const m = street.match(/^(\d+)\b/);
  return m ? (m[1] ?? null) : null;
};

const zip5 = (zip: string | null): string | null => {
  if (!zip) return null;
  const m = zip.match(/^(\d{5})/);
  return m ? (m[1] ?? null) : null;
};

export function scorePharmacyCandidate(
  parsed: ParsedPharmacyText,
  candidate: PharmacyCandidate,
): number {
  // Clients write the storefront (DBA) name, not the legal one — score
  // against every known name and keep the best.
  const candidateNames = [candidate.name, ...(candidate.altNames ?? [])];
  const name = Math.max(
    ...candidateNames.map((n) => nameSimilarity(parsed.name, n)),
  );

  const parsedZip = zip5(parsed.zip);
  const candidateZip = zip5(candidate.zip);
  const zip = parsedZip !== null && parsedZip === candidateZip ? 1 : 0;

  const parsedStreetNo = streetNumber(parsed.street);
  const candidateStreetNo = streetNumber(candidate.address1);
  const street =
    parsedStreetNo !== null && parsedStreetNo === candidateStreetNo ? 1 : 0;

  const score = W_NAME * name + W_ZIP * zip + W_STREET * street;
  // Rounded so scores are stable across environments and safe to persist
  // into numeric(4,3) columns.
  return Math.round(score * 1000) / 1000;
}

export function matchPharmacy(
  parsed: ParsedPharmacyText,
  candidates: PharmacyCandidate[],
): PharmacyMatch[] {
  return candidates
    .map((candidate) => ({ candidate, score: scorePharmacyCandidate(parsed, candidate) }))
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.name.localeCompare(b.candidate.name) ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
}
