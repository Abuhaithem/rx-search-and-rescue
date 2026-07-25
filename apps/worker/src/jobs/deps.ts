/**
 * Shared job dependencies. Every external boundary (DB, Storage, Claude,
 * RxNorm, NPPES, PDF text layer) is injected so jobs are testable without
 * network — createJobDeps() is the production wiring and reads env at call
 * time, never at module load.
 */
import { createExtractor, type Extractor } from "../lib/anthropic";
import { createWorkerDb, type Db } from "../lib/db";
import { createNppesClient, type NppesClient } from "../lib/nppes";
import { pdfTextReader, type PdfTextReader } from "../lib/pdf";
import { createRxNormClient, type RxNormClient } from "../lib/rxnorm";
import { createStorage, type StorageDownloader } from "../lib/storage";

export interface JobDeps {
  db: Db;
  storage: StorageDownloader;
  extractor: Extractor;
  rxnorm: RxNormClient;
  nppes: NppesClient;
  pdf: PdfTextReader;
}

export function createJobDeps(): JobDeps {
  return {
    db: createWorkerDb(),
    storage: createStorage(),
    extractor: createExtractor(),
    rxnorm: createRxNormClient(),
    nppes: createNppesClient(),
    pdf: pdfTextReader,
  };
}
