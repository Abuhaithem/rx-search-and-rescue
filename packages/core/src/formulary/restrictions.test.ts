/**
 * Exhaustive coverage of the CMS "Requirements/Limits" grammar as observed in
 * the Discovery sample set (§3.1–3.2): five real carriers, restriction strings
 * verbatim from formulary PDFs.
 */
import { describe, expect, it } from "vitest";
import { formatRestrictions, parseRestrictions, type ParsedRestrictions } from "./restrictions";

const EMPTY: ParsedRestrictions = { pa: false, st: false, ql: null, extraFlags: [] };

describe("parseRestrictions — single flags", () => {
  it('parses "PA"', () => {
    expect(parseRestrictions("PA")).toEqual({ ...EMPTY, pa: true });
  });

  it('parses "ST"', () => {
    expect(parseRestrictions("ST")).toEqual({ ...EMPTY, st: true });
  });

  it('parses a bare unknown code ("NM") into extraFlags', () => {
    expect(parseRestrictions("NM")).toEqual({ ...EMPTY, extraFlags: ["NM"] });
  });
});

describe("parseRestrictions — QL variants (all periods seen in discovery)", () => {
  it('parses "QL (240 per 30 days)"', () => {
    expect(parseRestrictions("QL (240 per 30 days)").ql).toEqual({ quantity: 240, days: 30 });
  });

  it('parses "QL (90 per 28 days)"', () => {
    expect(parseRestrictions("QL (90 per 28 days)").ql).toEqual({ quantity: 90, days: 28 });
  });

  it('parses "QL (10 per 5 days)"', () => {
    expect(parseRestrictions("QL (10 per 5 days)").ql).toEqual({ quantity: 10, days: 5 });
  });

  it('parses comma-thousands "QL (1,000 per 180 days)"', () => {
    expect(parseRestrictions("QL (1,000 per 180 days)").ql).toEqual({
      quantity: 1000,
      days: 180,
    });
  });

  it('parses singular "day": "QL (1 per 1 day)"', () => {
    expect(parseRestrictions("QL (1 per 1 day)").ql).toEqual({ quantity: 1, days: 1 });
  });

  it("tolerates missing space before the paren and internal padding", () => {
    expect(parseRestrictions("QL( 60 per 30 days )").ql).toEqual({ quantity: 60, days: 30 });
  });

  it("QL alone sets no boolean flags", () => {
    expect(parseRestrictions("QL (240 per 30 days)")).toEqual({
      ...EMPTY,
      ql: { quantity: 240, days: 30 },
    });
  });
});

describe("parseRestrictions — compound strings from real formularies", () => {
  it('parses "PA; QL (240 per 30 days); NEDS"', () => {
    expect(parseRestrictions("PA; QL (240 per 30 days); NEDS")).toEqual({
      pa: true,
      st: false,
      ql: { quantity: 240, days: 30 },
      extraFlags: ["NEDS"],
    });
  });

  it('parses "QL (240 per 30 days); NEDS" (tramadol row)', () => {
    expect(parseRestrictions("QL (240 per 30 days); NEDS")).toEqual({
      pa: false,
      st: false,
      ql: { quantity: 240, days: 30 },
      extraFlags: ["NEDS"],
    });
  });

  it('parses "PA; QL (90 per 30 days); NEDS" (morphine sulfate row)', () => {
    expect(parseRestrictions("PA; QL (90 per 30 days); NEDS")).toEqual({
      pa: true,
      st: false,
      ql: { quantity: 90, days: 30 },
      extraFlags: ["NEDS"],
    });
  });

  it('parses "PA; ST; QL (30 per 30 days)" with everything set', () => {
    expect(parseRestrictions("PA; ST; QL (30 per 30 days)")).toEqual({
      pa: true,
      st: true,
      ql: { quantity: 30, days: 30 },
      extraFlags: [],
    });
  });
});

describe('parseRestrictions — "B/D PA" compound flag (Discovery §3.2)', () => {
  it('"B/D PA; NM" must NOT set pa and must preserve both flags verbatim', () => {
    const parsed = parseRestrictions("B/D PA; NM");
    expect(parsed.pa).toBe(false);
    expect(parsed.st).toBe(false);
    expect(parsed.ql).toBeNull();
    expect(parsed.extraFlags).toEqual(["B/D PA", "NM"]);
  });

  it('"B/D PA" alone stays out of pa', () => {
    expect(parseRestrictions("B/D PA")).toEqual({ ...EMPTY, extraFlags: ["B/D PA"] });
  });

  it('"PA; B/D PA" sets pa AND preserves the compound flag', () => {
    expect(parseRestrictions("PA; B/D PA")).toEqual({
      ...EMPTY,
      pa: true,
      extraFlags: ["B/D PA"],
    });
  });
});

describe("parseRestrictions — empty / null variants", () => {
  it.each([
    ["em-dash", "—"],
    ["hyphen", "-"],
    ["empty string", ""],
    ["whitespace only", "   "],
  ])("returns the empty result for %s", (_label, raw) => {
    expect(parseRestrictions(raw)).toEqual(EMPTY);
  });

  it("returns the empty result for null", () => {
    expect(parseRestrictions(null)).toEqual(EMPTY);
  });

  it("returns the empty result for undefined", () => {
    expect(parseRestrictions(undefined)).toEqual(EMPTY);
  });

  it("padded em-dash is still empty", () => {
    expect(parseRestrictions("  —  ")).toEqual(EMPTY);
  });
});

describe("parseRestrictions — whitespace and casing", () => {
  it("trims padding around the string and around each token", () => {
    expect(parseRestrictions("  PA ;  ST ;  NEDS  ")).toEqual({
      ...EMPTY,
      pa: true,
      st: true,
      extraFlags: ["NEDS"],
    });
  });

  it('is case-insensitive: "pa; ql (60 per 30 days)"', () => {
    expect(parseRestrictions("pa; ql (60 per 30 days)")).toEqual({
      ...EMPTY,
      pa: true,
      ql: { quantity: 60, days: 30 },
    });
  });

  it('is case-insensitive for "st"', () => {
    expect(parseRestrictions("st").st).toBe(true);
  });

  it("skips empty tokens produced by doubled semicolons", () => {
    expect(parseRestrictions("PA;; ST;")).toEqual({ ...EMPTY, pa: true, st: true });
  });
});

describe("parseRestrictions — unknown codes preserved verbatim, in order", () => {
  it("keeps carrier-specific codes in source order", () => {
    expect(parseRestrictions("NM; NEDS; B/D PA").extraFlags).toEqual(["NM", "NEDS", "B/D PA"]);
  });

  it("does not normalize unknown-code casing", () => {
    expect(parseRestrictions("NeDs").extraFlags).toEqual(["NeDs"]);
  });

  it('a malformed QL ("QL (60)") is preserved verbatim rather than dropped', () => {
    const parsed = parseRestrictions("QL (60)");
    expect(parsed.ql).toBeNull();
    expect(parsed.extraFlags).toEqual(["QL (60)"]);
  });
});

describe("formatRestrictions — round-trips of canonical strings", () => {
  it.each([
    "PA",
    "ST",
    "PA; ST",
    "QL (240 per 30 days)",
    "QL (90 per 28 days)",
    "QL (10 per 5 days)",
    "PA; QL (240 per 30 days); NEDS",
    "PA; ST; QL (30 per 30 days)",
    "B/D PA; NM",
    "NM; NEDS",
  ])("format(parse(%j)) round-trips exactly", (raw) => {
    expect(formatRestrictions(parseRestrictions(raw))).toBe(raw);
  });

  it('renders the empty result as "—"', () => {
    expect(formatRestrictions(parseRestrictions(null))).toBe("—");
    expect(formatRestrictions(parseRestrictions("—"))).toBe("—");
    expect(formatRestrictions(EMPTY)).toBe("—");
  });

  it("normalizes comma-thousands on the way back out", () => {
    expect(formatRestrictions(parseRestrictions("QL (1,000 per 180 days)"))).toBe(
      "QL (1000 per 180 days)",
    );
  });

  it("canonicalizes lowercase input to uppercase flags", () => {
    expect(formatRestrictions(parseRestrictions("pa; ql (60 per 30 days)"))).toBe(
      "PA; QL (60 per 30 days)",
    );
  });

  it("emits flags in canonical order PA, ST, QL, then extras", () => {
    expect(formatRestrictions(parseRestrictions("NEDS; QL (60 per 30 days); ST; PA"))).toBe(
      "PA; ST; QL (60 per 30 days); NEDS",
    );
  });
});
