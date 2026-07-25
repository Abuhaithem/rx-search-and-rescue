/**
 * Free NLM RxNorm REST client. In-memory Map caches — the ingest jobs hit the
 * same drug names repeatedly and the free API is rate-limited (~20 req/s).
 */
import { z } from "zod";

export interface RxNormClient {
  /** Normalized-name lookup; null on miss. */
  findRxcuiByString(name: string): Promise<string | null>;
  /** Brand↔generic crosswalk RXCUIs (SBD/SCD/GPCK/BPCK), excluding the input. */
  getRelatedRxcuis(rxcui: string): Promise<string[]>;
}

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface RxNormDeps {
  fetch?: FetchLike;
  baseUrl?: string;
}

const DEFAULT_BASE = "https://rxnav.nlm.nih.gov/REST";

const idGroupResponse = z.object({
  idGroup: z
    .object({ rxnormId: z.array(z.string()).optional() })
    .optional(),
});

const approximateResponse = z.object({
  approximateGroup: z
    .object({
      candidate: z
        .array(z.object({ rxcui: z.string().optional() }))
        .optional(),
    })
    .optional(),
});

const relatedResponse = z.object({
  relatedGroup: z
    .object({
      conceptGroup: z
        .array(
          z.object({
            conceptProperties: z
              .array(z.object({ rxcui: z.string() }))
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export function createRxNormClient(deps: RxNormDeps = {}): RxNormClient {
  const fetchImpl: FetchLike =
    deps.fetch ?? ((url) => globalThis.fetch(url));
  const baseUrl = (
    deps.baseUrl ??
    process.env.RXNORM_API_BASE ??
    DEFAULT_BASE
  ).replace(/\/$/, "");

  const rxcuiCache = new Map<string, string | null>();
  const relatedCache = new Map<string, string[]>();

  async function getJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`RxNorm request failed (${response.status}): ${url}`);
    }
    return response.json();
  }

  return {
    async findRxcuiByString(name) {
      const key = name.trim().toLowerCase();
      if (key === "") return null;
      const cached = rxcuiCache.get(key);
      if (cached !== undefined) return cached;

      // search=2 → normalized search (case/order-insensitive).
      const exact = idGroupResponse.parse(
        await getJson(`${baseUrl}/rxcui.json?name=${encodeURIComponent(key)}&search=2`),
      );
      let rxcui = exact.idGroup?.rxnormId?.[0] ?? null;

      if (rxcui === null) {
        const approx = approximateResponse.parse(
          await getJson(
            `${baseUrl}/approximateTerm.json?term=${encodeURIComponent(key)}&maxEntries=1`,
          ),
        );
        rxcui = approx.approximateGroup?.candidate?.[0]?.rxcui ?? null;
      }

      rxcuiCache.set(key, rxcui);
      return rxcui;
    },

    async getRelatedRxcuis(rxcui) {
      const cached = relatedCache.get(rxcui);
      if (cached !== undefined) return cached;

      const parsed = relatedResponse.parse(
        await getJson(
          `${baseUrl}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=SBD+SCD+GPCK+BPCK`,
        ),
      );
      const related = new Set<string>();
      for (const group of parsed.relatedGroup?.conceptGroup ?? []) {
        for (const concept of group.conceptProperties ?? []) {
          if (concept.rxcui !== rxcui) related.add(concept.rxcui);
        }
      }
      const result = [...related].sort();
      relatedCache.set(rxcui, result);
      return result;
    },
  };
}
