import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { ReportModel } from "@rxsr/core/report-model";
import { renderDocx } from "./docx-renderer";
import { generateReportDocx } from "./index";

/** Minimal zip reader (central directory walk + raw-deflate) — avoids new deps. */
function extractZipEntry(zip: Buffer, entryName: string): string {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entryCount; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === entryName) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data.toString("utf8") : inflateRawSync(data).toString("utf8");
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip entry not found: ${entryName}`);
}

const fixtureModel: ReportModel = {
  clientName: "Jane Bentley",
  clientExternalId: null,
  planYear: 2026,
  preparedBy: "Brandi Agent",
  agencyName: "Test Agency",
  preparedDate: "2026-07-25",
  pharmacyNotes: [
    "The Drug Store — you will receive Standard Pricing on the MyCare 24 plan.",
  ],
  agentNotes: "Dr. Smith is in network on both plans.\nClient prefers 90-day fills.",
  planNames: ["Humana Basic Rx", "MyCare 24"],
  currentPlanIndex: 0,
  grid: [
    {
      medicationName: "Eliquis",
      cells: [
        { display: "$47 -T3", coverage: "covered", overridden: false },
        { display: "Not Covered", coverage: "not_on_formulary", overridden: false },
      ],
    },
    {
      medicationName: "Hydrocodone/Acet (prn)",
      cells: [
        { display: "$8 -T2", coverage: "covered", overridden: false },
        { display: "50% Cost of Medication", coverage: "covered", overridden: true },
      ],
    },
  ],
  costMatrix: {
    rows: [
      {
        label: "The Drug Store",
        cells: [
          { display: "$48/mo", channelLabel: "Standard Retail", cheapest: false, unavailable: false },
          { display: "$42/mo", channelLabel: "Preferred Retail", cheapest: true, unavailable: false },
        ],
      },
      {
        label: "Mail order (90-day)",
        cells: [
          { display: "Out of Network", channelLabel: "Out of Network", cheapest: false, unavailable: true },
          { display: "$36/mo", channelLabel: "Preferred Mail", cheapest: true, unavailable: false },
        ],
      },
    ],
    note: "* Estimate excludes drugs with no listed copay at that pharmacy.",
  },
  benefits: [
    {
      planName: "Humana Basic Rx",
      carrierName: "Humana",
      premium: "$0.00",
      rxDeductible: "$340.00",
      channelHeaders: ["30 DAY Standard", "30 Day Preferred"],
      channels: ["standard_retail", "preferred_retail"],
      tierRows: [
        { label: "T1", values: ["$1", "$0"] },
        { label: "T3", values: ["$47", "$42"] },
        { label: "Covered Insulin", values: ["$35", "$35"] },
      ],
    },
    {
      planName: "MyCare 24",
      carrierName: "PacificSource",
      premium: "$63.40",
      rxDeductible: "$0.00",
      channelHeaders: ["30 DAY In Network"],
      channels: ["standard_retail"],
      tierRows: [
        { label: "T1", values: ["$0"] },
        { label: "T2", values: ["$8"] },
      ],
    },
  ],
  deductibleFootnote:
    "RX Deductible applies to Tier 3, Tier 4 and Tier 5 medications on all plans",
  disclaimer: "Cost sharing shown is the plan's tier copay or coinsurance, not a pharmacy price.",
};

describe("renderDocx", () => {
  it("produces a non-empty zip (docx) buffer", async () => {
    const buffer = await renderDocx(fixtureModel);
    expect(buffer.length).toBeGreaterThan(0);
    // .docx is a zip: PK magic bytes
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("is reachable through the public generateReportDocx contract", async () => {
    const buffer = await generateReportDocx(fixtureModel);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("document XML contains the expected header, grid cells and benefit rows", async () => {
    const buffer = await renderDocx(fixtureModel);
    const xml = extractZipEntry(buffer, "word/document.xml");
    const expected = [
      "Prescription Drug Plan Analysis — Jane Bentley",
      "Prepared by Brandi Agent · Test Agency · Plan year 2026 · 2026-07-25",
      "The Drug Store — you will receive Standard Pricing on the MyCare 24 plan.",
      "Dr. Smith is in network on both plans.",
      "Eliquis",
      "Hydrocodone/Acet (prn)",
      "$47 -T3",
      "$8 -T2",
      "Not Covered",
      "50% Cost of Medication",
      "Estimated Monthly Cost by Pharmacy",
      "The Drug Store",
      "$48/mo",
      "Mail order (90-day)",
      "Preferred Mail",
      "Humana — Humana Basic Rx",
      "PacificSource — MyCare 24",
      "Plan Premium",
      "RX Deductible",
      "30 DAY Standard",
      "30 Day Preferred",
      "30 DAY In Network",
      "Covered Insulin",
      "RX Deductible applies to Tier 3, Tier 4 and Tier 5 medications on all plans",
    ];
    for (const text of expected) {
      expect(xml).toContain(text);
    }
  });

  it("never introduces rescue orange into the client-facing artifact", async () => {
    const buffer = await renderDocx(fixtureModel);
    const xml = extractZipEntry(buffer, "word/document.xml");
    expect(xml.toUpperCase()).not.toContain("FF6A2B");
    expect(xml.toUpperCase()).not.toContain("F97316");
  });
});
