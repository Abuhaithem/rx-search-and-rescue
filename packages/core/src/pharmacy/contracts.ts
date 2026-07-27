/**
 * Pharmacy resolution contracts: free-text RxC pharmacy string → canonical
 * pharmacy. Implementation lives in ./match.ts (pure) + the worker's NPPES
 * client (I/O).
 */

export interface ParsedPharmacyText {
  /** "The Drug Store - 91 E Croy Hailey ID 83333" → name segment. */
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  raw: string;
}

export interface PharmacyCandidate {
  id: string; // pharmacies.id (or NPPES NPI for not-yet-imported)
  npi: string | null;
  /** Legal organization name from NPPES. */
  name: string;
  /** DBA / storefront names (NPPES other_names) — what clients actually write. */
  altNames?: string[];
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface PharmacyMatch {
  candidate: PharmacyCandidate;
  /** 0–1; below CONFIRM_THRESHOLD the UI must require agent confirmation. */
  score: number;
}

export const PHARMACY_CONFIRM_THRESHOLD = 0.85;
