import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { scanCmsZip } from "./cms-archive";

/** adm-zip builds the test fixtures; runtime parsing stays unzipper/streaming. */
function writeFixtureZip(entries: Record<string, string>): string {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "cms-fixture-"));
  const zipPath = path.join(dir, "fixture.zip");
  writeFileSync(zipPath, zip.toBuffer());
  return zipPath;
}

// Reordered columns on purpose: header-name-driven mapping must tolerate it.
const NETWORK_FILE = [
  "PLAN_ID|CONTRACT_ID|SEGMENT_ID|PHARMACY_NUMBER|PREFERRED_STATUS_RETAIL|PHARMACY_RETAIL|PHARMACY_MAIL",
  "033|H1350|0|1234567890|Y|Y|N", // target, known NPI, preferred
  "033|H1350|0|9999999999|N|Y|N", // target, known NPI, standard
  "033|H1350|0|5555555555|Y|Y|N", // target, UNKNOWN NPI → dropped
  "001|S5601|0|1234567890|N|Y|N", // non-target plan → dropped
  "033|H1350|0|8888888888|Y|N|Y", // mail-only → dropped
  "033|H1350|0|badnpi|Y|Y|N", // malformed NPI
  "033|H1350", // truncated line
].join("\n");

const COST_FILE = [
  "CONTRACT_ID|PLAN_ID|SEGMENT_ID|COVERAGE_LEVEL|TIER|DAYS_SUPPLY|COST_TYPE_PREF|COST_AMT_PREF|COST_TYPE_NONPREF|COST_AMT_NONPREF|COST_TYPE_MAIL_PREF|COST_AMT_MAIL_PREF|COST_TYPE_MAIL_NONPREF|COST_AMT_MAIL_NONPREF",
  "H1350|033|0|1|1|1|1|10.00|1|15.00|1|0.00||",
  "H1350|033|0|1|4|1|2|50||||||", // coinsurance preferred only
  "H1350|033|0|2|1|1|1|10.00||||||", // coverage gap → filtered
  "S5601|001|0|1|1|1|1|1.00||||||", // non-target plan → dropped
  "H1350|033|0|1|1|9|1|10.00||||||", // bad days-supply code → malformed
].join("\n");

describe("scanCmsZip", () => {
  const zipPath = writeFixtureZip({
    "plan information 2026Q1.txt": "CONTRACT_ID|PLAN_ID\nH1350|033",
    "pharmacy networks 2026Q1.txt": NETWORK_FILE,
    "beneficiary cost 2026Q1.txt": COST_FILE,
    "insulin beneficiary cost 2026Q1.txt": "CONTRACT_ID|PLAN_ID\nH1350|033",
  });

  const options = {
    targetKeys: new Set(["H1350-033"]),
    knownNpis: new Set(["1234567890", "9999999999", "8888888888"]),
  };

  it("classifies every entry and logs what was found", async () => {
    const result = await scanCmsZip(zipPath, options);
    expect(result.entries.map((e) => e.kind).sort()).toEqual([
      "beneficiary_costs",
      "other",
      "pharmacy_networks",
      "plan_information",
    ]);
    expect(result.networks.fileFound).toBe(true);
    expect(result.costs.fileFound).toBe(true);
  });

  it("streams network rows scoped to target plans + known NPIs, retail only", async () => {
    const result = await scanCmsZip(zipPath, options);
    expect(result.networks.rows).toEqual([
      { key: "H1350-033", npi: "1234567890", preferredRetail: true, isRetail: true, isMail: false },
      { key: "H1350-033", npi: "9999999999", preferredRetail: false, isRetail: true, isMail: false },
    ]);
    expect(result.networks.linesScanned).toBe(7);
    expect(result.networks.malformed).toBe(2); // bad NPI + truncated line
  });

  it("streams cost rows scoped to target plans with filtered/malformed counts", async () => {
    const result = await scanCmsZip(zipPath, options);
    expect(result.costs.rows).toHaveLength(2);
    expect(result.costs.rows[0]?.channels).toEqual([
      { channel: "preferred_retail", daysSupply: 30, copayCents: 1000, coinsurancePct: null },
      { channel: "standard_retail", daysSupply: 30, copayCents: 1500, coinsurancePct: null },
      { channel: "preferred_mail", daysSupply: 30, copayCents: 0, coinsurancePct: null },
    ]);
    expect(result.costs.rows[1]?.channels).toEqual([
      { channel: "preferred_retail", daysSupply: 30, copayCents: null, coinsurancePct: "50.00" },
    ]);
    expect(result.costs.filtered).toBe(1);
    expect(result.costs.malformed).toBe(1);
  });

  it("reports progress with the discovered entries", async () => {
    const messages: string[] = [];
    await scanCmsZip(zipPath, { ...options, onProgress: (m) => void messages.push(m) });
    expect(messages[0]).toContain("pharmacy networks 2026Q1.txt [pharmacy_networks]");
  });
});
