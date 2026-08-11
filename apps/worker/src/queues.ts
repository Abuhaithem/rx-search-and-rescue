/**
 * Queue names + job payload contracts. The web app enqueues by inserting an
 * ingestion_jobs row AND adding a BullMQ job; the worker consumes and updates
 * the row so the admin UI can render progress by polling.
 */
export const QUEUE_NAMES = {
  formularyIngest: "formulary-ingest",
  rxcIntake: "rxc-intake",
  pharmacyDirectory: "pharmacy-directory",
  xlsxImport: "xlsx-import",
  sobIngest: "sob-ingest",
  cmsImport: "cms-import",
} as const;

export interface FormularyIngestJob {
  ingestionJobId: string;
  formularyId: string;
  /** Object-storage key of the uploaded PDF. */
  storagePath: string;
}

export interface RxcIntakeJob {
  ingestionJobId: string;
  clientId: string;
  storagePath: string;
}

export interface PharmacyDirectoryJob {
  ingestionJobId: string;
  /** The network belongs to the carrier, scoped to one plan year. */
  carrierId: string;
  planYear: number;
  storagePath: string;
  /** Wizard staging: rows land invisible until Finalize. */
  staged?: boolean;
}

export interface SobIngestJob {
  ingestionJobId: string;
  planIds: string[];
  storagePath: string;
}

export interface XlsxImportJob {
  ingestionJobId: string;
  carrierId: string;
  planYear: number;
  storagePath: string;
}

export interface CmsImportJob {
  ingestionJobId: string;
  planYear: number;
  /** Download URL of the CMS Quarterly PDP ZIP archive (admin-pasted). */
  sourceUrl: string;
}
