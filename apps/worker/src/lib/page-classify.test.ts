import { describe, expect, it } from "vitest";
import { classifyFormularyPage } from "./page-classify";

// Condensed from the real 2026 sample set (Blue Cross, Cigna, Humana, UHC).

const TABLE_PAGE = `DRUG NAME

DRUG TIER

REQUIREMENTS / LIMITS

labetalol hcl oral

2

lisinopril oral

1

lisinopril-hydrochlorothiazide oral tablet 10-12.5
mg, 20-12.5 mg

1

QL (120 per 30 days)`;

// Humana-style continuation page: no column headers besides DRUG NAME.
const TABLE_PAGE_MINIMAL_HEADER = `DRUG NAME

PREZISTA 75 MG TABLET MO
RETROVIR 10 MG/ML SOLUTION MO
ribavirin 200 mg CAPSULE MO
ritonavir 100 mg TABLET MO`;

// Headerless continuation: dosage tokens are the only signal.
const TABLE_PAGE_NO_HEADER = `metformin hcl oral tablet 500 mg
1
metformin hcl oral tablet 850 mg
1
metformin hcl er oral tablet extended release 24 hr 500 mg
2`;

const INDEX_PAGE = `LENVIMA (24 MG DAILY DOSE)
............................................16
LESSINA...................................55
letrozole..................................16
leucovorin calcium..................16
LEUKERAN...............................16
leuprolide acetate ..................16
levalbuterol hcl .......................77
levetiracetam .........................34
levobunolol hcl........................75
levocarnitine...........................44
levofloxacin.......................69, 75
LEVONEST ...............................55
levothyroxine sodium .............55`;

const PROSE_PAGE = `Note to existing members: This formulary has changed since last year. Please review this document to
make sure that it still contains the drugs you take.
When this Drug List (formulary) refers to "we," "us", or "our," it means Blue Cross of Idaho. When it refers
to "plan" or "our plan," it means True Blue Rx 32PSP, True Blue Rx 33, True Blue Rx 34, True Blue Rx 35PSP.
This document includes a Drug List (formulary) for our plan which is current as of 01/01/2026. For an
updated Drug List (formulary), please contact us. Our contact information appears on the cover pages.
You must generally use network pharmacies to use your prescription drug benefit.`;

describe("classifyFormularyPage", () => {
  it("extracts pages with table headers", () => {
    expect(classifyFormularyPage(TABLE_PAGE)).toBe("extract");
  });

  it("extracts continuation pages with only a DRUG NAME header", () => {
    expect(classifyFormularyPage(TABLE_PAGE_MINIMAL_HEADER)).toBe("extract");
  });

  it("extracts headerless continuation pages on dosage density", () => {
    expect(classifyFormularyPage(TABLE_PAGE_NO_HEADER)).toBe("extract");
  });

  it("skips alphabetical index pages with dotted leaders", () => {
    expect(classifyFormularyPage(INDEX_PAGE)).toBe("skip");
  });

  it("skips prose front matter", () => {
    expect(classifyFormularyPage(PROSE_PAGE)).toBe("skip");
  });

  it("extracts when the text layer is empty (scanned page)", () => {
    expect(classifyFormularyPage("")).toBe("extract");
    expect(classifyFormularyPage("   \n  ")).toBe("extract");
  });

  it("extracts prose-adjacent pages that mention restriction notation", () => {
    const page = `${PROSE_PAGE}\nSome drugs are limited: QL (30 per 30 days) applies.`;
    expect(classifyFormularyPage(page)).toBe("extract");
  });
});
