import { describe, expect, it } from "vitest";
import { parseZctaCountyRelationship } from "./census-zcta";

/**
 * Format-accurate snippet mirroring the real tab20_zcta520_county20_natl.txt:
 * BOM + full header, county-only rows with an empty ZCTA side, out-of-state
 * rows, a multi-county ZCTA, and a duplicate relationship row.
 */
const HEADER =
  "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_COUNTY_20|GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|AREAWATER_COUNTY_20|MTFCC_COUNTY_20|CLASSFP_COUNTY_20|FUNCSTAT_COUNTY_20|AREALAND_PART|AREAWATER_PART";

const SAMPLE = [
  "﻿" + HEADER,
  // county area not covered by any ZCTA (empty ZCTA side) — skipped
  "||||||||27590114112812|16013|Blaine County|4117656199|1132956041|G4020|H1|A|339765765|927218265",
  // Alabama row — filtered out by the state FIPS prefix
  "221004871|35004|ZCTA5 35004|29444242|29033|G6350|B5|S|27590114112812|01115|St. Clair County|1563660622|25989727|G4020|H1|A|29444242|29033",
  // Hailey, Blaine County
  "221008333|83333|ZCTA5 83333|1230000000|500000|G6350|B5|S|27590114112899|16013|Blaine County|6842160000|36000000|G4020|H1|A|1230000000|500000",
  // duplicate relationship row (parts of the same pair) — deduped
  "221008333|83333|ZCTA5 83333|1230000000|500000|G6350|B5|S|27590114112899|16013|Blaine County|6842160000|36000000|G4020|H1|A|9000|10",
  // multi-county ZCTA: 83227 spans Custer and Lemhi
  "221008227|83227|ZCTA5 83227|900|0|G6350|B5|S|27590114112900|16037|Custer County|1|2|G4020|H1|A|3|4",
  "221008227|83227|ZCTA5 83227|900|0|G6350|B5|S|27590114112901|16059|Lemhi County|1|2|G4020|H1|A|3|4",
  "",
].join("\n");

describe("parseZctaCountyRelationship", () => {
  it("filters to the state prefix, strips ' County', dedupes, and sorts", () => {
    const rows = parseZctaCountyRelationship(SAMPLE, {
      stateFipsPrefix: "16",
      state: "ID",
    });
    expect(rows).toEqual([
      { zip: "83227", state: "ID", county: "Custer" },
      { zip: "83227", state: "ID", county: "Lemhi" },
      { zip: "83333", state: "ID", county: "Blaine" },
    ]);
  });

  it("skips county-only rows with no ZCTA", () => {
    const rows = parseZctaCountyRelationship(SAMPLE, {
      stateFipsPrefix: "16",
      state: "ID",
    });
    expect(rows.filter((r) => r.zip === "")).toEqual([]);
  });

  it("keeps other states out even when the file has them", () => {
    const alabama = parseZctaCountyRelationship(SAMPLE, {
      stateFipsPrefix: "01",
      state: "AL",
    });
    expect(alabama).toEqual([{ zip: "35004", state: "AL", county: "St. Clair" }]);
  });

  it("throws on an unrecognized header", () => {
    expect(() =>
      parseZctaCountyRelationship("A|B|C\n1|2|3", { stateFipsPrefix: "16", state: "ID" }),
    ).toThrow(/unexpected ZCTA relationship header/);
  });

  it("throws on an empty file", () => {
    expect(() =>
      parseZctaCountyRelationship("", { stateFipsPrefix: "16", state: "ID" }),
    ).toThrow();
  });
});
