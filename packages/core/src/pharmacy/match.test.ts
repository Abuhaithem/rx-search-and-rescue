import { describe, expect, it } from "vitest";
import type { PharmacyCandidate } from "./contracts";
import { PHARMACY_CONFIRM_THRESHOLD } from "./contracts";
import { matchPharmacy, nameSimilarity, scorePharmacyCandidate } from "./match";
import { parsePharmacyText } from "./parse";

const candidate = (over: Partial<PharmacyCandidate>): PharmacyCandidate => ({
  id: "c-default",
  npi: null,
  name: "Placeholder",
  address1: null,
  city: null,
  state: null,
  zip: null,
  ...over,
});

const drugStore = parsePharmacyText("The Drug Store - 91 E Croy Hailey ID 83333");

describe("nameSimilarity", () => {
  it("ignores punctuation and case", () => {
    expect(nameSimilarity("Ridley's Pharmacy", "RIDLEYS PHARMACY")).toBe(1);
  });

  it("ignores corporate noise words", () => {
    expect(nameSimilarity("Valley Apothecary", "VALLEY APOTHECARY INC")).toBe(1);
    expect(nameSimilarity("Sav-On Pharmacy", "SAV-ON LLC")).toBe(1);
  });

  it("falls back to full tokens when a name is all noise words", () => {
    expect(nameSimilarity("The Drug Store", "THE DRUG STORE INC")).toBeGreaterThan(0.7);
    expect(nameSimilarity("The Drug Store", "Hailey Apothecary")).toBe(0);
  });

  it("ignores store numbers", () => {
    expect(nameSimilarity("Walgreens #123", "WALGREENS #4021")).toBe(1);
  });
});

describe("scorePharmacyCandidate", () => {
  it("scores a perfect match at 1.0", () => {
    const score = scorePharmacyCandidate(
      drugStore,
      candidate({ name: "THE DRUG STORE", address1: "91 E CROY ST", zip: "83333" }),
    );
    expect(score).toBe(1);
  });

  it("zip + exact name without street reaches the confirm threshold", () => {
    const score = scorePharmacyCandidate(
      drugStore,
      candidate({ name: "The Drug Store", address1: null, zip: "83333" }),
    );
    expect(score).toBeCloseTo(PHARMACY_CONFIRM_THRESHOLD, 5);
  });

  it("gives no zip credit when either zip is missing or different", () => {
    const noZip = scorePharmacyCandidate(drugStore, candidate({ name: "The Drug Store" }));
    const wrongZip = scorePharmacyCandidate(
      drugStore,
      candidate({ name: "The Drug Store", zip: "83340" }),
    );
    expect(noZip).toBe(0.5);
    expect(wrongZip).toBe(0.5);
  });

  it("compares zips on the first five digits", () => {
    const score = scorePharmacyCandidate(
      drugStore,
      candidate({ name: "The Drug Store", zip: "83333-1234" }),
    );
    expect(score).toBeCloseTo(0.85, 5);
  });
});

describe("matchPharmacy", () => {
  it("sorts matches by score descending", () => {
    const matches = matchPharmacy(drugStore, [
      candidate({ id: "weak", name: "Hailey Health Mart", zip: "83333" }),
      candidate({ id: "best", name: "THE DRUG STORE", address1: "91 E Croy", zip: "83333" }),
      candidate({ id: "mid", name: "The Drug Store", zip: "83340" }),
    ]);
    expect(matches.map((m) => m.candidate.id)).toEqual(["best", "mid", "weak"]);
    expect(matches[0]?.score).toBe(1);
  });

  it("drops zero-score candidates", () => {
    const matches = matchPharmacy(drugStore, [
      candidate({ id: "unrelated", name: "Boise Vision Clinic", zip: "83702" }),
    ]);
    expect(matches).toEqual([]);
  });

  it("is deterministic for tied scores (stable tiebreak by name then id)", () => {
    const a = candidate({ id: "a", name: "The Drug Store", zip: "83333" });
    const b = candidate({ id: "b", name: "The Drug Store", zip: "83333" });
    const first = matchPharmacy(drugStore, [b, a]);
    const second = matchPharmacy(drugStore, [a, b]);
    expect(first.map((m) => m.candidate.id)).toEqual(["a", "b"]);
    expect(second.map((m) => m.candidate.id)).toEqual(["a", "b"]);
  });

  it("handles name-only parses", () => {
    const parsed = parsePharmacyText("Valley Apothecary");
    const matches = matchPharmacy(parsed, [
      candidate({ id: "v", name: "VALLEY APOTHECARY INC", zip: "83340" }),
    ]);
    expect(matches[0]?.score).toBe(0.5);
  });

  it("returns [] for empty candidate lists", () => {
    expect(matchPharmacy(drugStore, [])).toEqual([]);
  });
});
