import { describe, expect, it } from "vitest";
import { matchPolicyToPlan, type PolicyPlanCandidate } from "./policy-match";

const CATALOG: PolicyPlanCandidate[] = [
  { id: "tb-33", name: "True Blue Rx 33 (HMO)", carrierName: "Blue Cross of Idaho", contractPlanId: "H1350-033" },
  { id: "tb-33psp", name: "True Blue Rx 33PSP (HMO)", carrierName: "Blue Cross of Idaho", contractPlanId: "H1350-133" },
  { id: "uhc-saver", name: "UHC Rx Saver (PDP)", carrierName: "UnitedHealthcare", contractPlanId: "S5921-405" },
  { id: "wellcare", name: "Wellcare Classic (PDP)", carrierName: "Wellcare", contractPlanId: null },
];

describe("matchPolicyToPlan", () => {
  it("matches by contract id regardless of name wording", () => {
    expect(
      matchPolicyToPlan(
        { rawText: "BCID drug plan H1350-033 eff 1/1/2025", carrierName: null, policyNumber: null },
        CATALOG,
      ),
    ).toEqual({ planId: "tb-33", method: "contract_id" });
  });

  it("matches a contract id carried in the policy number", () => {
    expect(
      matchPolicyToPlan(
        { rawText: "Medicare drug coverage", carrierName: "UHC", policyNumber: "S5921405" },
        CATALOG,
      ),
    ).toEqual({ planId: "uhc-saver", method: "contract_id" });
  });

  it("matches by full plan-name containment", () => {
    expect(
      matchPolicyToPlan(
        { rawText: "True Blue Rx 33 (HMO) — PDP coverage", carrierName: "Blue Cross of Idaho", policyNumber: null },
        CATALOG,
      ),
    ).toEqual({ planId: "tb-33", method: "plan_name" });
  });

  it("prefers the more specific name: 33PSP policy never lands on plain 33", () => {
    expect(
      matchPolicyToPlan(
        { rawText: "True Blue Rx 33PSP (HMO)", carrierName: null, policyNumber: null },
        CATALOG,
      ),
    ).toEqual({ planId: "tb-33psp", method: "plan_name" });
  });

  it("uses the carrier name as part of the haystack", () => {
    expect(
      matchPolicyToPlan(
        { rawText: "Classic (PDP)", carrierName: "Wellcare", policyNumber: null },
        CATALOG,
      ),
    ).toEqual({ planId: "wellcare", method: "plan_name" });
  });

  it("returns null when nothing matches", () => {
    expect(
      matchPolicyToPlan(
        { rawText: "Humana Walmart Value Rx", carrierName: "Humana", policyNumber: null },
        CATALOG,
      ),
    ).toBeNull();
  });

  it("returns null on empty policy text", () => {
    expect(matchPolicyToPlan({ rawText: "", carrierName: null, policyNumber: null }, CATALOG)).toBeNull();
  });
});
