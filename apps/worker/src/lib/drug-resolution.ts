/**
 * The drug-name resolution ladder. Maps incoming names (brand, generic,
 * misspelled) onto the generic-name index derived from ingested formularies,
 * stopping at the first hit:
 *
 *   1. exact      — normalized key is a known generic
 *   2. alias      — learned brand→generic dictionary (drug_aliases)
 *   3. fuzzy      — typo tolerance only, ambiguity refuses
 *   4. llm        — ONE batched call for everything still unresolved
 *   5. unresolved — flagged; never guessed
 *
 * Every accepted LLM answer is verified against the generic index before use
 * and written back to drug_aliases, so a brand name costs one LLM call ever.
 */
import {
  and,
  drugAliases,
  eq,
  formularyEntries,
  inArray,
  isNotNull,
  type Db,
} from "@rxsr/db";
import { fuzzyResolveGeneric, normalizeDrugKey } from "@rxsr/core";
import type { ExtractionProvider } from "./extraction/types";

export type DrugResolutionPath = "exact" | "alias" | "fuzzy" | "llm" | "unresolved";

export interface DrugResolution {
  /** Normalized generic key ("ezetimibe", combos "ezetimibe simvastatin"). */
  genericKey: string | null;
  path: DrugResolutionPath;
}

/** Below this the LLM's answer is discarded as unresolved. */
const LLM_MIN_CONFIDENCE = 0.6;
/** Names per batched LLM call. */
const LLM_BATCH_SIZE = 40;

/**
 * The generic-name index: normalized molecule keys of every generic
 * (lowercase-printed) formulary row on file, across plan years.
 */
export async function loadGenericIndex(db: Db): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ normalizedName: formularyEntries.normalizedName })
    .from(formularyEntries)
    .where(
      and(eq(formularyEntries.isBrand, false), isNotNull(formularyEntries.normalizedName)),
    );
  const index = new Set<string>();
  for (const row of rows) {
    const key = normalizeDrugKey(row.normalizedName!);
    if (key !== "") index.add(key);
  }
  return index;
}

const llmPrompt = (names: string[]): string =>
  [
    "Resolve each of these drug names to its generic name. Echo each input verbatim.",
    "",
    ...names.map((n) => `- ${n}`),
  ].join("\n");

export async function resolveDrugNames(
  db: Db,
  extractor: ExtractionProvider,
  rawNames: string[],
): Promise<Map<string, DrugResolution>> {
  const results = new Map<string, DrugResolution>();
  const uniqueRaw = [...new Set(rawNames)];
  if (uniqueRaw.length === 0) return results;

  const genericIndex = await loadGenericIndex(db);
  const keyByRaw = new Map(uniqueRaw.map((raw) => [raw, normalizeDrugKey(raw)]));

  const keys = [...new Set([...keyByRaw.values()].filter((k) => k !== ""))];
  const aliasRows =
    keys.length > 0
      ? await db
          .select({ alias: drugAliases.alias, genericName: drugAliases.genericName })
          .from(drugAliases)
          .where(inArray(drugAliases.alias, keys))
      : [];
  const aliasByKey = new Map(aliasRows.map((row) => [row.alias, row.genericName]));

  const pendingLlm: string[] = [];
  for (const raw of uniqueRaw) {
    const key = keyByRaw.get(raw)!;
    if (key === "") {
      results.set(raw, { genericKey: null, path: "unresolved" });
    } else if (genericIndex.has(key)) {
      results.set(raw, { genericKey: key, path: "exact" });
    } else if (aliasByKey.has(key)) {
      results.set(raw, { genericKey: aliasByKey.get(key)!, path: "alias" });
    } else {
      const fuzzy = fuzzyResolveGeneric(key, genericIndex);
      if (fuzzy !== null) results.set(raw, { genericKey: fuzzy, path: "fuzzy" });
      else pendingLlm.push(raw);
    }
  }

  for (let start = 0; start < pendingLlm.length; start += LLM_BATCH_SIZE) {
    const batch = pendingLlm.slice(start, start + LLM_BATCH_SIZE);
    // A failed call degrades to unresolved — resolution is never fatal.
    const response = await extractor.resolveDrugNames(llmPrompt(batch)).catch(() => null);
    const byInput = new Map((response?.items ?? []).map((item) => [item.input, item]));

    for (const raw of batch) {
      const item = byInput.get(raw) ?? byInput.get(normalizeDrugKey(raw));
      const accepted =
        item != null &&
        item.resolved &&
        item.genericName != null &&
        item.confidence >= LLM_MIN_CONFIDENCE;
      const genericKey = accepted
        ? item.isCombination && item.components.length > 1
          ? item.components.map(normalizeDrugKey).filter(Boolean).join(" ")
          : normalizeDrugKey(item.genericName!)
        : null;

      // The model's answer must exist in OUR database — an unknown generic
      // is treated as unresolved, exactly like a refusal.
      if (genericKey !== null && genericKey !== "" && genericIndex.has(genericKey)) {
        results.set(raw, { genericKey, path: "llm" });
        await db
          .insert(drugAliases)
          .values({
            alias: keyByRaw.get(raw)!,
            genericName: genericKey,
            isCombination: item!.isCombination,
            components: item!.components.map(normalizeDrugKey).filter(Boolean),
            source: "llm",
            confidence: item!.confidence.toFixed(3),
          })
          .onConflictDoNothing();
      } else {
        results.set(raw, { genericKey: null, path: "unresolved" });
      }
    }
  }

  return results;
}
