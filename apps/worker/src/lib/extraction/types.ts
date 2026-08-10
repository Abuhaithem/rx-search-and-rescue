/**
 * Provider abstraction for AI extraction. Every implementation validates its
 * output through the zod contracts (see ./schemas) before returning — the
 * validation gate is provider-independent and non-negotiable.
 */
import type { FormularyPage, RxcExtraction } from "@rxsr/core/intake";
import type {
  FormularyLegendExtraction,
  FormularyPlanNamesExtraction,
  PharmacyDirectoryExtraction,
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
}

export type {
  FormularyLegendExtraction,
  PharmacyDirectoryExtraction,
} from "./schemas";
