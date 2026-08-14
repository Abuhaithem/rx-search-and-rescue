/**
 * In-force policy → plan-catalog matching. RxC exports print the client's
 * current plan as free text ("True Blue Rx 33 (HMO) H1350-033"); this maps
 * that text onto a plan row so the analysis gets its "current plan" column.
 * Deterministic and conservative: a contract id is proof, full plan-name
 * containment is a match, anything ambiguous returns null — the agent
 * confirms or corrects the suggestion at intake, it is never trusted blindly.
 */

export interface PolicyPlanCandidate {
  id: string;
  name: string;
  carrierName: string;
  contractPlanId: string | null;
}

export interface PolicyToMatch {
  rawText: string;
  carrierName: string | null;
  policyNumber: string | null;
}

export interface PolicyPlanMatch {
  planId: string;
  method: "contract_id" | "plan_name";
}

/** "H1350-033" → "h1350033": comparable across dash/space variants. */
const compactAlnum = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const tokenize = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      // "32psp" → "32 psp": policy text and catalog spell suffixes both ways.
      .replace(/(\d)([a-z])/g, "$1 $2")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .split(" ")
      .filter(Boolean),
  );

export function matchPolicyToPlan(
  policy: PolicyToMatch,
  candidates: PolicyPlanCandidate[],
): PolicyPlanMatch | null {
  const haystackCompact = compactAlnum(`${policy.rawText} ${policy.policyNumber ?? ""}`);

  // 1. Contract id in the policy text/number — unambiguous.
  for (const candidate of candidates) {
    if (!candidate.contractPlanId) continue;
    const contract = compactAlnum(candidate.contractPlanId);
    if (contract.length >= 5 && haystackCompact.includes(contract)) {
      return { planId: candidate.id, method: "contract_id" };
    }
  }

  // 2. Full plan-name containment: every token of the plan's name appears in
  // the policy text. The most specific containment (most tokens) wins so
  // "True Blue Rx 33PSP" beats "True Blue Rx 33" on a 33PSP policy; a tie
  // between different plans is ambiguity, and ambiguity is a null.
  const haystackTokens = tokenize(`${policy.rawText} ${policy.carrierName ?? ""}`);
  let best: { candidate: PolicyPlanCandidate; tokenCount: number } | null = null;
  let bestIsTied = false;
  for (const candidate of candidates) {
    const nameTokens = tokenize(candidate.name);
    if (nameTokens.size < 2) continue; // one-word names are too weak to trust
    let contained = true;
    for (const token of nameTokens) {
      if (!haystackTokens.has(token)) {
        contained = false;
        break;
      }
    }
    if (!contained) continue;
    if (best === null || nameTokens.size > best.tokenCount) {
      best = { candidate, tokenCount: nameTokens.size };
      bestIsTied = false;
    } else if (nameTokens.size === best.tokenCount && candidate.id !== best.candidate.id) {
      bestIsTied = true;
    }
  }
  if (best && !bestIsTied) return { planId: best.candidate.id, method: "plan_name" };

  return null;
}
