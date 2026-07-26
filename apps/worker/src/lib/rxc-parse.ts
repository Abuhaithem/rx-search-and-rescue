/**
 * Deterministic parser for AgencyBloc RxC export PDFs, working on the pdf.js
 * text layer. The RxC layout is consistent, so the intake path parses it
 * WITHOUT any LLM — PHI (client name + medication list) never leaves the
 * worker. The LLM provider's extractRxc remains only as a fallback for layout
 * drift and scanned PDFs (see jobs/rxc-intake.ts).
 *
 * Observed text-layer linearization (ground truth: the three client-provided
 * sample exports, copied to test/fixtures/rxc/*.txt):
 *  - Header: "<Name> (no group or carrier)" as the first line.
 *  - Preferred Pharmacies block: all field LABELS first, then the VALUES in
 *    field order: takes-prescriptions Yes/No, ZIP (printed twice), the
 *    "Search for pharmacies within…" caption, 0–3 pharmacy strings, the
 *    "If left blank:…" caption, delivery Yes/No.
 *  - Current Prescriptions: header row may wrap ("…Refill / Frequency /
 *    Generic / OK Updat"). Row cells may be inline on one line
 *    ("Cortef hydrocortisone (Tablets) TAB 10MG 60 30 Yes Felix Gonzalez")
 *    or wrapped across many lines with the dosage column split mid-word.
 *    The reliable row terminator is the "<qty> <refill> <Yes|No>" anchor;
 *    an "Updated" timestamp line (possibly truncated, e.g. "10/6/2") follows.
 *  - The Dosage column usually repeats the Medication column verbatim
 *    (generic rows); brand rows may not ("Cortef" + generic description).
 *  - Additional Information (optional): one caption line, then free text
 *    linearized WITHOUT its original separators, ending with a submit
 *    timestamp glued on.
 *  - IN FORCE POLICIES: "Carrier - Number - Type" lines, or
 *    "No in force policies. Create new".
 */
import {
  rxcExtractionSchema,
  type ExtractedMedication,
  type ExtractedPolicy,
  type RxcExtraction,
} from "@rxsr/core/intake";

const YES_NO_RE = /^(Yes|No)$/i;
const ZIP_LINE_RE = /^\d{5}$/;
/** "<dosage tail?> <qty> <refill> <Yes|No> <updated-by tail?>" */
const ROW_ANCHOR_RE = /^(.*?)\s*(\d+)\s+(\d+)\s+(Yes|No)\b\s*(.*)$/;
/** Updated-timestamp line, possibly truncated by the column ("10/6/2"). */
const TIMESTAMP_LINE_RE = /^\d{1,2}\/\d{1,2}\/\d+/;
/** Submit timestamp glued to the end of the Additional Information blob. */
const TRAILING_TIMESTAMP_RE =
  /\s*\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?)?(\s+[A-Z]{1,3})?\s*$/i;
const FORM_OR_STRENGTH_RE =
  /\b(TABS?|TABLETS?|CAPS?|CAPSULES?|SOL|SOLN|SUSP|INJ|CREAM|CRE|OIN|SYP|SYRUP|PATCH|INH|SPRAY|GEL|LOT|DROPS)\b|\d+(\.\d+)?\s*(MG|MCG|GM?|ML|MEQ|%)/i;

const HEADER_WORDS = [
  "Medication",
  "Dosage",
  "Quantity",
  "Refill",
  "Frequency",
  "Generic",
  "OK",
  "Updated",
  "By",
];

class RxcParseError extends Error {}

const toLines = (pagesText: string[]): string[] =>
  pagesText
    .join("\n")
    .split(/[\n\f]/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

const findIndex = (
  lines: string[],
  predicate: (line: string) => boolean,
  from = 0,
): number => {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && predicate(line)) return i;
  }
  return -1;
};

/** Column-header line: every token is (a truncated prefix of) a header word. */
const isTableHeaderLine = (line: string): boolean =>
  line
    .split(/\s+/)
    .every((token) =>
      HEADER_WORDS.some(
        (word) =>
          token === word || (token.length >= 2 && word.startsWith(token)),
      ),
    );

// ─── Sections ────────────────────────────────────────────────────────────────

function parseClientName(lines: string[]): string {
  const first = lines[0];
  if (first === undefined) throw new RxcParseError("empty text layer");
  const name = first.replace(/\s*\(no group or carrier\)\s*$/i, "").trim();
  if (name === "") throw new RxcParseError("no client name in header");
  return name;
}

interface PharmacyBlock {
  takesPrescriptions: boolean | null;
  zip: string | null;
  preferredPharmacies: string[];
  deliveryPreferred: boolean | null;
}

function parsePharmacyBlock(lines: string[], start: number, end: number): PharmacyBlock {
  const block = lines.slice(start, end);
  const searchCaption = findIndex(block, (l) => /^Search for pharmacies/i.test(l));
  const blankCaption = findIndex(block, (l) => /^If left blank:/i.test(l));
  if (searchCaption === -1 || blankCaption === -1) {
    throw new RxcParseError("Preferred Pharmacies captions not found");
  }

  const before = block.slice(0, searchCaption);
  const yesNo = before.find((l) => YES_NO_RE.test(l));
  const zip = before.find((l) => ZIP_LINE_RE.test(l)) ?? null;

  const preferredPharmacies = block
    .slice(searchCaption + 1, blankCaption)
    .filter((l) => !YES_NO_RE.test(l))
    .slice(0, 3);

  const deliveryLine = block.slice(blankCaption + 1).find((l) => YES_NO_RE.test(l));

  return {
    takesPrescriptions: yesNo === undefined ? null : /^Yes$/i.test(yesNo),
    zip,
    preferredPharmacies,
    deliveryPreferred: deliveryLine === undefined ? null : /^Yes$/i.test(deliveryLine),
  };
}

/**
 * Split "<name cells><dosage cells>" using the layout's own redundancy: the
 * dosage column almost always repeats the medication column, so the longest
 * doubled token prefix is the name. Brand rows without repetition fall back
 * to first-token name when a form/strength marker is present.
 */
export function splitNameAndDosage(text: string): { name: string; dosageText: string | null } {
  const tokens = text.split(/\s+/).filter(Boolean);
  for (let k = Math.floor(tokens.length / 2); k >= 1; k--) {
    let doubled = true;
    for (let i = 0; i < k; i++) {
      if (tokens[i] !== tokens[k + i]) {
        doubled = false;
        break;
      }
    }
    if (doubled) {
      return {
        name: tokens.slice(0, k).join(" "),
        dosageText: tokens.slice(k).join(" "),
      };
    }
  }
  if (tokens.length > 1 && FORM_OR_STRENGTH_RE.test(text)) {
    return { name: tokens[0] ?? text, dosageText: tokens.slice(1).join(" ") };
  }
  return { name: text, dosageText: null };
}

function parsePrescriptions(
  lines: string[],
  start: number,
  end: number,
): ExtractedMedication[] {
  const section = lines.slice(start, end);

  // Consume the (possibly wrapped) column-header lines at the top.
  let cursor = 0;
  while (cursor < section.length) {
    const line = section[cursor];
    if (line === undefined || !isTableHeaderLine(line)) break;
    cursor++;
  }

  const medications: ExtractedMedication[] = [];
  let buffer: string[] = [];

  for (let i = cursor; i < section.length; i++) {
    const line = section[i];
    if (line === undefined) continue;
    if (TIMESTAMP_LINE_RE.test(line)) continue;

    const anchor = line.match(ROW_ANCHOR_RE);
    if (!anchor) {
      buffer.push(line);
      continue;
    }

    const [, dosageTail, quantityText, refillText, genericText] = anchor;
    const cellText = [...buffer, dosageTail ?? ""]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const rawText = [...buffer, line].join("\n");
    buffer = [];
    if (cellText === "") continue;

    const { name, dosageText } = splitNameAndDosage(cellText);
    medications.push({
      name,
      dosageText,
      quantity: Number(quantityText),
      daysSupply: Number(refillText),
      genericOk: /^Yes$/i.test(genericText ?? ""),
      prn: /\(prn\)|\bas needed\b/i.test(cellText),
      source: "structured",
      confidence: 1,
      rawText,
    });
  }

  return medications;
}

function parseAdditionalInformation(
  lines: string[],
  start: number,
  end: number,
): ExtractedMedication[] {
  const body = lines
    .slice(start, end)
    .filter((l) => !/^Other prescriptions/i.test(l) && !/^Submitted$/i.test(l));
  if (body.length === 0) return [];

  // The submit timestamp is glued onto the last line.
  const text = body.join("\n").replace(TRAILING_TIMESTAMP_RE, "").trim();
  if (text === "") return [];

  // Deliberately NOT LLM-parsed: split on the form's separators and let the
  // intake review screen structure the entries.
  return text
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => ({
      name: entry,
      dosageText: null,
      quantity: null,
      daysSupply: null,
      genericOk: null,
      prn: /\(prn\)|\bas needed\b/i.test(entry),
      source: "freetext" as const,
      confidence: 0.5,
      rawText: entry,
    }));
}

export function classifyPolicyType(text: string): ExtractedPolicy["policyType"] {
  if (/\bPDP\b/i.test(text)) return "pdp";
  if (/MAPD|MA-PD|MA\s+PD|Medicare\s+Advantage/i.test(text)) return "ma_pd";
  if (/Med\s*Supp|Medicare\s+Supplement|Medigap/i.test(text)) return "med_supp";
  return "other";
}

function parsePolicies(lines: string[], start: number, end: number): ExtractedPolicy[] {
  const policies: ExtractedPolicy[] = [];
  for (const line of lines.slice(start, end)) {
    if (/no in force policies/i.test(line)) return [];
    if (/^Create new$/i.test(line)) continue;
    const parts = line.split(/\s+-\s+/).map((p) => p.trim());
    if (parts.length >= 3) {
      policies.push({
        rawText: line,
        carrierName: parts[0] ?? null,
        policyNumber: parts[1] ?? null,
        policyType: classifyPolicyType(parts.slice(2).join(" ")),
      });
    } else if (parts.length === 2) {
      const second = parts[1] ?? "";
      const type = classifyPolicyType(second);
      policies.push({
        rawText: line,
        carrierName: parts[0] ?? null,
        policyNumber: type === "other" ? second : null,
        policyType: type,
      });
    } else {
      policies.push({
        rawText: line,
        carrierName: null,
        policyNumber: null,
        policyType: classifyPolicyType(line),
      });
    }
  }
  return policies;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function parseRxcText(pagesText: string[]): RxcExtraction {
  const lines = toLines(pagesText);
  if (lines.length === 0) throw new RxcParseError("empty text layer");

  const clientName = parseClientName(lines);

  const prefIdx = findIndex(lines, (l) => /^Preferred Pharmacies$/i.test(l));
  const rxIdx = findIndex(lines, (l) => /^Current Prescriptions/i.test(l));
  if (prefIdx === -1 || rxIdx === -1 || rxIdx <= prefIdx) {
    throw new RxcParseError("RxC section anchors not found (layout drift?)");
  }
  const additionalIdx = findIndex(lines, (l) => /^Additional Information$/i.test(l), rxIdx);
  const contactIdx = findIndex(lines, (l) => /^CONTACT INFO/i.test(l), rxIdx);
  const policiesIdx = findIndex(lines, (l) => /^IN FORCE POLICIES/i.test(l));

  const pharmacyBlock = parsePharmacyBlock(lines, prefIdx + 1, rxIdx);

  const rxEnd =
    [additionalIdx, contactIdx, policiesIdx, lines.length]
      .filter((i) => i > rxIdx)
      .sort((a, b) => a - b)[0] ?? lines.length;
  const structured = parsePrescriptions(lines, rxIdx + 1, rxEnd);

  const freetext =
    additionalIdx === -1
      ? []
      : parseAdditionalInformation(
          lines,
          additionalIdx + 1,
          [contactIdx, policiesIdx, lines.length]
            .filter((i) => i > additionalIdx)
            .sort((a, b) => a - b)[0] ?? lines.length,
        );

  let policies: ExtractedPolicy[] = [];
  if (policiesIdx !== -1) {
    const policiesEnd = findIndex(
      lines,
      (l) => /^(RELATIONSHIPS|ACTIVITIES|PINNED NOTE)/i.test(l),
      policiesIdx + 1,
    );
    policies = parsePolicies(
      lines,
      policiesIdx + 1,
      policiesEnd === -1 ? lines.length : policiesEnd,
    );
  }

  // The zod contract is the gate for this parser exactly as for the LLM path.
  return rxcExtractionSchema.parse({
    clientName,
    zip: pharmacyBlock.zip,
    takesPrescriptions: pharmacyBlock.takesPrescriptions,
    preferredPharmacies: pharmacyBlock.preferredPharmacies,
    deliveryPreferred: pharmacyBlock.deliveryPreferred,
    medications: [...structured, ...freetext],
    inForcePolicies: policies,
  });
}
