/**
 * Shared job dependencies. Every external boundary (DB, Storage, the LLM
 * extraction provider, RxNorm, NPPES, PDF text layer) is injected so jobs are
 * testable without network — createJobDeps() is the production wiring and
 * reads env at call time, never at module load (a missing provider API key
 * therefore fails the job, not the worker boot).
 */
import { getExtractionProvider, type ExtractionProvider } from "../lib/extraction";
import { createWorkerDb, type Db } from "../lib/db";
import { createNppesClient, type NppesClient } from "../lib/nppes";
import { pdfTextReader, type PdfTextReader } from "../lib/pdf";
import { createRxNormClient, type RxNormClient } from "../lib/rxnorm";
import { createStorage, type StorageDownloader } from "../lib/storage";

export interface JobDeps {
  db: Db;
  storage: StorageDownloader;
  extractor: ExtractionProvider;
  rxnorm: RxNormClient;
  nppes: NppesClient;
  pdf: PdfTextReader;
}

export function createJobDeps(): JobDeps {
  // Lazy: the deterministic RxC path never touches the LLM, so a missing
  // provider API key must not fail intake jobs. The provider is constructed
  // on first access (formulary ingest, pharmacy directory, or LLM fallback).
  let extractor: ExtractionProvider | undefined;
  return {
    db: createWorkerDb(),
    storage: createStorage(),
    get extractor() {
      extractor ??= getExtractionProvider();
      return extractor;
    },
    rxnorm: createRxNormClient(),
    nppes: createNppesClient(),
    pdf: pdfTextReader,
  };
}
