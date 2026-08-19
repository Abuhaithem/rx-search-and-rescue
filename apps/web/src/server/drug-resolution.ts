/**
 * Deterministic rungs of the drug-name resolution ladder, runnable in the
 * web app: exact → learned/seeded alias → fuzzy. NO LLM here — that rung is
 * worker-only, at ingestion. Used when an agent confirms intake so edited,
 * manual, or pre-feature medications get resolved without re-ingestion.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drugAliases, formularyEntries, getDb } from "@rxsr/db";
import { fuzzyResolveGeneric, normalizeDrugKey } from "@rxsr/core";

export interface DeterministicDrugResolution {
  genericKey: string | null;
  path: "exact" | "alias" | "fuzzy" | "unresolved";
}

export async function resolveDrugNamesDeterministic(
  rawNames: string[],
): Promise<Map<string, DeterministicDrugResolution>> {
  const results = new Map<string, DeterministicDrugResolution>();
  const uniqueRaw = [...new Set(rawNames.filter((n) => n.trim() !== ""))];
  if (uniqueRaw.length === 0) return results;

  const db = getDb();
  const indexRows = await db
    .selectDistinct({ normalizedName: formularyEntries.normalizedName })
    .from(formularyEntries)
    .where(
      and(eq(formularyEntries.isBrand, false), isNotNull(formularyEntries.normalizedName)),
    );
  const genericIndex = new Set<string>();
  for (const row of indexRows) {
    const key = normalizeDrugKey(row.normalizedName!);
    if (key !== "") genericIndex.add(key);
  }

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
      results.set(
        raw,
        fuzzy !== null
          ? { genericKey: fuzzy, path: "fuzzy" }
          : { genericKey: null, path: "unresolved" },
      );
    }
  }
  return results;
}
