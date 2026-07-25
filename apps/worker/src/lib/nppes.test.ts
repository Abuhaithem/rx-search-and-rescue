import { describe, expect, it } from "vitest";
import type { FetchLike } from "./rxnorm";
import { createNppesClient } from "./nppes";

const sampleResponse = {
  result_count: 2,
  results: [
    {
      number: 1234567890,
      basic: { organization_name: "THE DRUG STORE INC" },
      addresses: [
        {
          address_purpose: "MAILING",
          address_1: "PO BOX 1",
          city: "HAILEY",
          state: "ID",
          postal_code: "833330001",
        },
        {
          address_purpose: "LOCATION",
          address_1: "91 E CROY ST",
          city: "HAILEY",
          state: "ID",
          postal_code: "833338800",
        },
      ],
    },
    {
      number: "9999999999",
      basic: {},
      addresses: [],
    },
  ],
};

function fakeFetch(payload: unknown): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => payload };
    },
  };
}

describe("searchPharmacies", () => {
  it("maps NPPES org results to PharmacyCandidates using the LOCATION address", async () => {
    const { fetch, calls } = fakeFetch(sampleResponse);
    const client = createNppesClient({ fetch, baseUrl: "https://nppes.test/api" });
    const candidates = await client.searchPharmacies({ zip: "83333", state: "ID" });

    expect(candidates).toEqual([
      {
        id: "1234567890",
        npi: "1234567890",
        name: "THE DRUG STORE INC",
        address1: "91 E CROY ST",
        city: "HAILEY",
        state: "ID",
        zip: "83333",
      },
    ]);

    const url = calls[0] ?? "";
    expect(url).toContain("https://nppes.test/api/?");
    expect(url).toContain("enumeration_type=NPI-2");
    expect(url).toContain("taxonomy_description=pharmacy");
    expect(url).toContain("postal_code=83333");
    expect(url).toContain("state=ID");
  });

  it("supports paging params and caps the limit", async () => {
    const { fetch, calls } = fakeFetch({ results: [] });
    const client = createNppesClient({ fetch, baseUrl: "https://nppes.test/api" });
    await client.searchPharmacies({ state: "ID", limit: 9999, skip: 400 });
    const url = calls[0] ?? "";
    expect(url).toContain("limit=200");
    expect(url).toContain("skip=400");
  });

  it("throws on HTTP failure", async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const client = createNppesClient({ fetch, baseUrl: "https://nppes.test" });
    await expect(client.searchPharmacies({ zip: "83333" })).rejects.toThrow(/503/);
  });
});
