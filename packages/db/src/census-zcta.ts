/**
 * Pure parser for the Census 2020 ZCTA↔county relationship file
 * (tab20_zcta520_county20_natl.txt — pipe-delimited, public domain).
 * Observed format: UTF-8 BOM + header row naming columns incl.
 * GEOID_ZCTA5_20, GEOID_COUNTY_20, NAMELSAD_COUNTY_20; data rows may have an
 * EMPTY ZCTA side (county land not covered by any ZCTA) — those are skipped.
 *
 * ZCTA ≈ ZIP is an approximation (USPS ZIPs are routes, ZCTAs are areas);
 * acceptable here because the intake screen makes the county
 * agent-confirmable for multi-county ZIPs.
 */

export interface ZipCountyRow {
  zip: string;
  state: string;
  county: string;
}

export interface ParseZctaOptions {
  /** Two-digit state FIPS prefix of GEOID_COUNTY_20, e.g. "16" for Idaho. */
  stateFipsPrefix: string;
  /** State abbreviation to stamp on every row, e.g. "ID". */
  state: string;
}

export function parseZctaCountyRelationship(
  text: string,
  options: ParseZctaOptions,
): ZipCountyRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLine = lines[0];
  if (!headerLine) throw new Error("empty ZCTA relationship file");

  const columns = headerLine.split("|");
  const zctaIndex = columns.indexOf("GEOID_ZCTA5_20");
  const countyIndex = columns.indexOf("GEOID_COUNTY_20");
  const countyNameIndex = columns.indexOf("NAMELSAD_COUNTY_20");
  if (zctaIndex === -1 || countyIndex === -1 || countyNameIndex === -1) {
    throw new Error(
      `unexpected ZCTA relationship header: ${headerLine.slice(0, 200)}`,
    );
  }

  const seen = new Set<string>();
  const rows: ZipCountyRow[] = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const fields = line.split("|");
    const zip = fields[zctaIndex]?.trim() ?? "";
    const countyFips = fields[countyIndex]?.trim() ?? "";
    const countyName = fields[countyNameIndex]?.trim() ?? "";

    if (!/^\d{5}$/.test(zip)) continue; // county areas outside any ZCTA
    if (countyFips.length !== 5 || !countyFips.startsWith(options.stateFipsPrefix)) {
      continue;
    }
    if (countyName === "") continue;

    const county = countyName.replace(/\s+County$/i, "");
    const key = `${zip}|${county}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ zip, state: options.state, county });
  }

  return rows.sort((a, b) => a.zip.localeCompare(b.zip) || a.county.localeCompare(b.county));
}
