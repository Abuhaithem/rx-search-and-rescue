import { describe, expect, it } from "vitest";
import {
  buildHeaderIndex,
  classifyCmsEntry,
  COST_FILE_HEADERS,
  COST_REQUIRED_FIELDS,
  decideCostInserts,
  decideNetworkActions,
  NETWORK_FILE_HEADERS,
  NETWORK_REQUIRED_FIELDS,
  parseContractPlanId,
  parseCostLine,
  parseNetworkLine,
  type CostCandidate,
} from "./cms";

describe("parseContractPlanId", () => {
  it("parses the canonical and tolerated variants", () => {
    expect(parseContractPlanId("H1350-033")).toEqual({ contract: "H1350", plan: "033" });
    expect(parseContractPlanId("H1350_033")).toEqual({ contract: "H1350", plan: "033" });
    expect(parseContractPlanId("H1350 033")).toEqual({ contract: "H1350", plan: "033" });
    expect(parseContractPlanId("h1350-33")).toEqual({ contract: "H1350", plan: "033" });
    expect(parseContractPlanId("S5601-1")).toEqual({ contract: "S5601", plan: "001" });
    expect(parseContractPlanId(" H1350-033 ")).toEqual({ contract: "H1350", plan: "033" });
  });

  it("rejects garbage", () => {
    expect(parseContractPlanId(null)).toBeNull();
    expect(parseContractPlanId("")).toBeNull();
    expect(parseContractPlanId("H135-033")).toBeNull();
    expect(parseContractPlanId("1350-033")).toBeNull();
    expect(parseContractPlanId("H1350-0334")).toBeNull();
    expect(parseContractPlanId("H1350")).toBeNull();
  });
});

describe("classifyCmsEntry", () => {
  it("classifies member files case-insensitively", () => {
    expect(classifyCmsEntry("Pharmacy Networks File 2026Q1.txt")).toBe("pharmacy_networks");
    expect(classifyCmsEntry("pharmacy_network_PPUF_2026.txt")).toBe("pharmacy_networks");
    expect(classifyCmsEntry("BENEFICIARY COST FILE.txt")).toBe("beneficiary_costs");
    expect(classifyCmsEntry("Insulin Beneficiary Cost File.txt")).toBe("other");
    expect(classifyCmsEntry("plan information 2026Q1.txt")).toBe("plan_information");
    expect(classifyCmsEntry("Geographic Locator.txt")).toBe("geographic_locator");
    expect(classifyCmsEntry("basic drugs formulary.txt")).toBe("other");
  });
});

describe("buildHeaderIndex", () => {
  it("maps by name regardless of column order, case, or spacing", () => {
    const index = buildHeaderIndex(
      ["Pharmacy Number", "PLAN_ID", "contract id", "PREFERRED_STATUS_RETAIL"],
      NETWORK_FILE_HEADERS,
      NETWORK_REQUIRED_FIELDS,
    );
    expect(index.npi).toBe(0);
    expect(index.plan).toBe(1);
    expect(index.contract).toBe(2);
    expect(index.preferredRetail).toBe(3);
    expect(index.retail).toBe(-1); // optional column absent
  });

  it("accepts alternative header spellings", () => {
    const index = buildHeaderIndex(
      ["CONTRACT_ID", "PLAN_ID", "NPI"],
      NETWORK_FILE_HEADERS,
      NETWORK_REQUIRED_FIELDS,
    );
    expect(index.npi).toBe(2);
  });

  it("throws listing missing required columns", () => {
    expect(() =>
      buildHeaderIndex(["CONTRACT_ID", "PLAN_ID"], NETWORK_FILE_HEADERS, NETWORK_REQUIRED_FIELDS),
    ).toThrow(/missing expected columns: PHARMACY_NUMBER/);
  });
});

const networkIndex = buildHeaderIndex(
  ["CONTRACT_ID", "PLAN_ID", "SEGMENT_ID", "PHARMACY_NUMBER", "PREFERRED_STATUS_RETAIL", "PHARMACY_RETAIL", "PHARMACY_MAIL"],
  NETWORK_FILE_HEADERS,
  NETWORK_REQUIRED_FIELDS,
);

describe("parseNetworkLine", () => {
  it("parses a preferred retail row", () => {
    const row = parseNetworkLine(
      ["H1350", "033", "0", "1234567890", "Y", "Y", "N"],
      networkIndex,
    );
    expect(row).toEqual({
      key: "H1350-033",
      npi: "1234567890",
      preferredRetail: true,
      isRetail: true,
      isMail: false,
    });
  });

  it("accepts 1/0 flags", () => {
    const row = parseNetworkLine(["H1350", "33", "0", "1234567890", "1", "1", "0"], networkIndex);
    expect(row?.preferredRetail).toBe(true);
    expect(row?.key).toBe("H1350-033");
  });

  it("returns null for malformed rows", () => {
    expect(parseNetworkLine(["", "033", "0", "1234567890", "Y", "Y", "N"], networkIndex)).toBeNull();
    expect(parseNetworkLine(["H1350", "033", "0", "12345", "Y", "Y", "N"], networkIndex)).toBeNull();
    expect(parseNetworkLine(["H1350", "033"], networkIndex)).toBeNull();
  });
});

const costHeader = [
  "CONTRACT_ID",
  "PLAN_ID",
  "SEGMENT_ID",
  "COVERAGE_LEVEL",
  "TIER",
  "DAYS_SUPPLY",
  "COST_TYPE_PREF",
  "COST_AMT_PREF",
  "COST_TYPE_NONPREF",
  "COST_AMT_NONPREF",
  "COST_TYPE_MAIL_PREF",
  "COST_AMT_MAIL_PREF",
  "COST_TYPE_MAIL_NONPREF",
  "COST_AMT_MAIL_NONPREF",
];
const costIndex = buildHeaderIndex(costHeader, COST_FILE_HEADERS, COST_REQUIRED_FIELDS);

describe("parseCostLine", () => {
  it("maps copay and coinsurance channels", () => {
    const result = parseCostLine(
      ["H1350", "033", "0", "1", "3", "1", "1", "47.00", "2", "25", "1", "131.00", "", ""],
      costIndex,
    );
    if (result.kind !== "row") throw new Error(`expected row, got ${result.kind}`);
    expect(result.row.key).toBe("H1350-033");
    expect(result.row.tier).toBe(3);
    expect(result.row.channels).toEqual([
      { channel: "preferred_retail", daysSupply: 30, copayCents: 4700, coinsurancePct: null },
      { channel: "standard_retail", daysSupply: 30, copayCents: null, coinsurancePct: "25.00" },
      { channel: "mail_order", daysSupply: 30, copayCents: 13100, coinsurancePct: null },
    ]);
  });

  it("maps the three-month days-supply code to 90", () => {
    const result = parseCostLine(
      ["H1350", "033", "0", "1", "1", "2", "1", "0.00", "", "", "", "", "", ""],
      costIndex,
    );
    if (result.kind !== "row") throw new Error("expected row");
    expect(result.row.channels[0]).toMatchObject({ daysSupply: 90, copayCents: 0 });
  });

  it("falls back to non-preferred mail when preferred mail is absent", () => {
    const result = parseCostLine(
      ["H1350", "033", "0", "1", "2", "1", "", "", "", "", "", "", "2", "30"],
      costIndex,
    );
    if (result.kind !== "row") throw new Error("expected row");
    expect(result.row.channels).toEqual([
      { channel: "mail_order", daysSupply: 30, copayCents: null, coinsurancePct: "30.00" },
    ]);
  });

  it("filters non-initial coverage levels and out-of-range tiers", () => {
    expect(
      parseCostLine(["H1350", "033", "0", "2", "3", "1", "1", "47.00", "", "", "", "", "", ""], costIndex).kind,
    ).toBe("filtered");
    expect(
      parseCostLine(["H1350", "033", "0", "1", "7", "1", "1", "47.00", "", "", "", "", "", ""], costIndex).kind,
    ).toBe("filtered");
  });

  it("counts malformed rows", () => {
    expect(parseCostLine(["", "033", "0", "1", "3", "1"], costIndex).kind).toBe("malformed");
    expect(
      parseCostLine(["H1350", "033", "0", "1", "3", "9", "1", "47.00", "", "", "", "", "", ""], costIndex).kind,
    ).toBe("malformed");
  });
});

describe("decideNetworkActions", () => {
  const candidate = (planId: string, pharmacyId: string, status: "preferred" | "standard") => ({
    planId,
    pharmacyId,
    status,
  });

  it("never touches agent-sourced rows", () => {
    const { upserts, preservedAgent } = decideNetworkActions(
      [candidate("p1", "ph1", "preferred"), candidate("p1", "ph2", "standard")],
      [
        { planId: "p1", pharmacyId: "ph1", source: "agent" },
        { planId: "p1", pharmacyId: "ph2", source: "directory" },
      ],
    );
    expect(preservedAgent).toBe(1);
    expect(upserts).toEqual([candidate("p1", "ph2", "standard")]);
  });

  it("dedupes duplicate CMS rows with preferred winning", () => {
    const { upserts } = decideNetworkActions(
      [candidate("p1", "ph1", "standard"), candidate("p1", "ph1", "preferred")],
      [],
    );
    expect(upserts).toEqual([candidate("p1", "ph1", "preferred")]);
  });
});

describe("decideCostInserts", () => {
  const candidate = (over: Partial<CostCandidate>): CostCandidate => ({
    planId: "p1",
    channel: "preferred_retail",
    tier: 1,
    daysSupply: 30,
    copayCents: 1000,
    coinsurancePct: null,
    ...over,
  });

  it("never overwrites existing rows", () => {
    const { inserts, skippedExisting } = decideCostInserts(
      [candidate({}), candidate({ tier: 2 })],
      new Set(["p1|preferred_retail|t1|30"]),
    );
    expect(skippedExisting).toBe(1);
    expect(inserts).toEqual([candidate({ tier: 2 })]);
  });

  it("dedupes within the file (first row wins)", () => {
    const { inserts } = decideCostInserts(
      [candidate({ copayCents: 1000 }), candidate({ copayCents: 9999 })],
      new Set(),
    );
    expect(inserts).toEqual([candidate({ copayCents: 1000 })]);
  });
});
