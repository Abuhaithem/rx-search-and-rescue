import { describe, expect, it } from "vitest";
import { createRxNormClient, type FetchLike } from "./rxnorm";

function fakeFetch(routes: Record<string, unknown>): {
  fetch: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const match = Object.entries(routes).find(([fragment]) => url.includes(fragment));
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => match[1] };
  };
  return { fetch, calls };
}

describe("findRxcuiByString", () => {
  it("returns the normalized-search rxcui", async () => {
    const { fetch, calls } = fakeFetch({
      "/rxcui.json": { idGroup: { rxnormId: ["308047"] } },
    });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test/REST" });
    expect(await client.findRxcuiByString("Eliquis TAB 2.5MG")).toBe("308047");
    expect(calls[0]).toContain("https://rx.test/REST/rxcui.json?name=");
    expect(calls[0]).toContain("search=2");
  });

  it("falls back to approximateTerm on miss", async () => {
    const { fetch, calls } = fakeFetch({
      "/rxcui.json": { idGroup: {} },
      "/approximateTerm.json": {
        approximateGroup: { candidate: [{ rxcui: "197361" }] },
      },
    });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    expect(await client.findRxcuiByString("hydrocort 10 mg")).toBe("197361");
    expect(calls).toHaveLength(2);
  });

  it("returns null on a full miss and caches it", async () => {
    const { fetch, calls } = fakeFetch({
      "/rxcui.json": { idGroup: {} },
      "/approximateTerm.json": { approximateGroup: {} },
    });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    expect(await client.findRxcuiByString("not a drug")).toBeNull();
    expect(await client.findRxcuiByString("NOT A DRUG ")).toBeNull();
    expect(calls).toHaveLength(2); // second call served from cache (case-insensitive)
  });

  it("caches hits by normalized name", async () => {
    const { fetch, calls } = fakeFetch({
      "/rxcui.json": { idGroup: { rxnormId: ["308047"] } },
    });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    await client.findRxcuiByString("eliquis");
    await client.findRxcuiByString("Eliquis");
    expect(calls).toHaveLength(1);
  });

  it("returns null for empty names without fetching", async () => {
    const { fetch, calls } = fakeFetch({});
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    expect(await client.findRxcuiByString("  ")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("throws on HTTP failure", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    await expect(client.findRxcuiByString("eliquis")).rejects.toThrow(/500/);
  });
});

describe("getRelatedRxcuis", () => {
  it("collects, dedupes, and sorts related rxcuis excluding the input", async () => {
    const { fetch, calls } = fakeFetch({
      "/related.json": {
        relatedGroup: {
          conceptGroup: [
            { conceptProperties: [{ rxcui: "999" }, { rxcui: "111" }] },
            { conceptProperties: [{ rxcui: "111" }, { rxcui: "42" }] },
            {},
          ],
        },
      },
    });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    expect(await client.getRelatedRxcuis("42")).toEqual(["111", "999"]);
    expect(calls[0]).toContain("/rxcui/42/related.json?tty=SBD+SCD+GPCK+BPCK");
  });

  it("caches by rxcui", async () => {
    const { fetch, calls } = fakeFetch({
      "/related.json": { relatedGroup: {} },
    });
    const client = createRxNormClient({ fetch, baseUrl: "https://rx.test" });
    expect(await client.getRelatedRxcuis("42")).toEqual([]);
    expect(await client.getRelatedRxcuis("42")).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
