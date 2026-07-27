/**
 * NPPES NPI Registry client. Organization pharmacies only (NPI-2 +
 * pharmacy taxonomy). The public API caps limit at 200 and skip at 1000, so a
 * single criteria set can return at most 1200 records — callers that need
 * state-wide coverage page with searchPharmacies({ state, skip }).
 */
import { z } from "zod";
import type { PharmacyCandidate } from "@rxsr/core/pharmacy";
import type { FetchLike } from "./rxnorm";

export interface NppesSearch {
  zip?: string;
  state?: string;
  limit?: number;
  skip?: number;
}

export interface NppesClient {
  searchPharmacies(search: NppesSearch): Promise<PharmacyCandidate[]>;
}

export interface NppesDeps {
  fetch?: FetchLike;
  baseUrl?: string;
}

const DEFAULT_BASE = "https://npiregistry.cms.hhs.gov/api";
export const NPPES_PAGE_LIMIT = 200;
export const NPPES_MAX_SKIP = 1000;

const nppesResponse = z.object({
  results: z
    .array(
      z.object({
        number: z.union([z.string(), z.number()]),
        basic: z
          .object({ organization_name: z.string().optional() })
          .optional(),
        /** DBA / former storefront names — what clients write on RxC forms. */
        other_names: z
          .array(
            z.object({
              organization_name: z.string().optional(),
              type: z.string().optional(),
            }),
          )
          .optional(),
        addresses: z
          .array(
            z.object({
              address_purpose: z.string().optional(),
              address_1: z.string().optional(),
              city: z.string().optional(),
              state: z.string().optional(),
              postal_code: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export function createNppesClient(deps: NppesDeps = {}): NppesClient {
  const fetchImpl: FetchLike = deps.fetch ?? ((url) => globalThis.fetch(url));
  const baseUrl = (
    deps.baseUrl ??
    process.env.NPPES_API_BASE ??
    DEFAULT_BASE
  ).replace(/\/$/, "");

  return {
    async searchPharmacies(search) {
      const params = new URLSearchParams({
        version: "2.1",
        enumeration_type: "NPI-2",
        taxonomy_description: "pharmacy",
        limit: String(Math.min(search.limit ?? NPPES_PAGE_LIMIT, NPPES_PAGE_LIMIT)),
      });
      if (search.zip) params.set("postal_code", search.zip);
      if (search.state) params.set("state", search.state);
      if (search.skip) params.set("skip", String(Math.min(search.skip, NPPES_MAX_SKIP)));

      const response = await fetchImpl(`${baseUrl}/?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`NPPES request failed (${response.status})`);
      }
      const parsed = nppesResponse.parse(await response.json());

      const candidates: PharmacyCandidate[] = [];
      for (const result of parsed.results ?? []) {
        const name = result.basic?.organization_name;
        if (!name) continue;
        const npi = String(result.number);
        const location =
          result.addresses?.find((a) => a.address_purpose === "LOCATION") ??
          result.addresses?.[0];
        // Legal name stays `name`; DBAs land in altNames (deduped, and never
        // repeating the legal name, case-insensitively).
        const seenNames = new Set([name.trim().toUpperCase()]);
        const altNames: string[] = [];
        for (const other of result.other_names ?? []) {
          const alt = other.organization_name?.trim();
          if (!alt) continue;
          const key = alt.toUpperCase();
          if (seenNames.has(key)) continue;
          seenNames.add(key);
          altNames.push(alt);
        }
        candidates.push({
          id: npi, // not yet imported: id carries the NPI per the contract
          npi,
          name,
          altNames,
          address1: location?.address_1 ?? null,
          city: location?.city ?? null,
          state: location?.state ?? null,
          zip: location?.postal_code?.slice(0, 5) ?? null,
        });
      }
      return candidates;
    },
  };
}
