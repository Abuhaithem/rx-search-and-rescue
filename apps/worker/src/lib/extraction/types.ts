/**
 * Provider abstraction for AI extraction. Every implementation validates its
 * output through the zod contracts (see ./schemas) before returning — the
 * validation gate is provider-independent and non-negotiable.
 */
import type { FormularyPage, RxcExtraction } from "@rxsr/core/intake";
import type {
  BrandGroupingExtraction,
  DrugResolutionExtraction,
  FormularyLegendExtraction,
  PharmacyRosterExtraction,
  FormularyPlanNamesExtraction,
  PharmacyDirectoryExtraction,
  PharmacyResolution,
  QuantityLimitPageExtraction,
  SobExtraction,
} from "./schemas";

export type ExtractionProviderName = "anthropic" | "openai" | "gemini";

export interface ExtractionCallOptions {
  /** Per-call model override (escalation retries). */
  model?: string;
}

export interface ExtractionProvider {
  readonly providerName: ExtractionProviderName;
  readonly model: string;
  /** Null = escalation disabled. */
  readonly escalationModel: string | null;
  /**
   * Max PDF pages this provider should receive per request; callers chunk
   * larger documents (lib/pdf-chunk). Undefined = send whole documents.
   */
  readonly maxContextPages?: number;

  extractRxc(
    pdfBase64: string,
    options?: ExtractionCallOptions,
  ): Promise<RxcExtraction>;
  extractFormularyPage(
    pdfBase64OrChunk: string,
    pageNumber: number,
    options?: ExtractionCallOptions,
  ): Promise<FormularyPage>;
  /** QL-appendix chart page (no tier column) — supplement, not entries. */
  extractQuantityLimitPage(
    pdfBase64OrChunk: string,
    pageNumber: number,
    options?: ExtractionCallOptions,
  ): Promise<QuantityLimitPageExtraction>;
  extractFormularyLegend(
    pdfBase64: string,
    options?: ExtractionCallOptions,
  ): Promise<FormularyLegendExtraction>;
  /** Reads the front matter; pass a front-matter sub-PDF, not the whole doc. */
  extractFormularyPlanNames(
    pdfBase64: string,
    options?: ExtractionCallOptions,
  ): Promise<FormularyPlanNamesExtraction>;
  extractSummaryOfBenefits(
    pdfBase64: string,
    options?: ExtractionCallOptions,
  ): Promise<SobExtraction>;
  extractPharmacyDirectoryRows(
    directoryText: string,
    options?: ExtractionCallOptions,
  ): Promise<PharmacyDirectoryExtraction>;
  /** Pick which numbered candidate a free-text pharmacy entry refers to. */
  resolvePharmacyCandidate(
    promptText: string,
    options?: ExtractionCallOptions,
  ): Promise<PharmacyResolution>;
  /** Batched brand→generic drug-name resolution (LLM ladder rung). */
  resolveDrugNames(
    promptText: string,
    options?: ExtractionCallOptions,
  ): Promise<DrugResolutionExtraction>;
  /** Active pharmacy locations from a statewide roster text chunk. */
  extractPharmacyRosterRows(
    rosterText: string,
    options?: ExtractionCallOptions,
  ): Promise<PharmacyRosterExtraction>;
  /** Group brand-name variants of the same chain (brand-tidy job). */
  groupPharmacyBrands(
    promptText: string,
    options?: ExtractionCallOptions,
  ): Promise<BrandGroupingExtraction>;
}

export type {
  FormularyLegendExtraction,
  PharmacyDirectoryExtraction,
} from "./schemas";
