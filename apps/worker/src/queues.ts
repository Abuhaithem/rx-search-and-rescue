/**
 * Queue names + job payload contracts. The web app enqueues by inserting an
 * ingestion_jobs row AND adding a BullMQ job; the worker consumes and updates
 * the row so the admin UI can render progress via Supabase Realtime.
 */
export const QUEUE_NAMES = {
  formularyIngest: "formulary-ingest",
  rxcIntake: "rxc-intake",
  pharmacyDirectory: "pharmacy-directory",
  nppesSeed: "nppes-seed",
} as const;

export interface FormularyIngestJob {
  ingestionJobId: string;
  formularyId: string;
  /** Supabase Storage path of the uploaded PDF. */
  storagePath: string;
}

export interface RxcIntakeJob {
  ingestionJobId: string;
  clientId: string;
  storagePath: string;
}

export interface PharmacyDirectoryJob {
  ingestionJobId: string;
  planId: string;
  storagePath: string;
}

export interface NppesSeedJob {
  ingestionJobId: string;
  state: string; // e.g. "ID"
}
