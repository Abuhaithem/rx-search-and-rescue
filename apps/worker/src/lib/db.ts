/**
 * Worker DB plumbing: connection factory + ingestion_jobs bookkeeping.
 * The ingestion_jobs row is what the admin UI polls for progress,
 * so every stage transition should land here promptly.
 */
import { createDb, eq, ingestionJobs, type Db } from "@rxsr/db";

export type { Db };

export function createWorkerDb(): Db {
  return createDb();
}

export interface JobProgress {
  page?: number;
  totalPages?: number;
  message?: string;
}

export async function markJobRunning(db: Db, ingestionJobId: string): Promise<void> {
  await db
    .update(ingestionJobs)
    .set({ status: "running", error: null, updatedAt: new Date() })
    .where(eq(ingestionJobs.id, ingestionJobId));
}

export async function updateJobProgress(
  db: Db,
  ingestionJobId: string,
  progress: JobProgress,
): Promise<void> {
  await db
    .update(ingestionJobs)
    .set({ progress, updatedAt: new Date() })
    .where(eq(ingestionJobs.id, ingestionJobId));
}

export async function markJobDone(
  db: Db,
  ingestionJobId: string,
  progress?: JobProgress,
): Promise<void> {
  await db
    .update(ingestionJobs)
    .set({
      status: "done",
      ...(progress ? { progress } : {}),
      updatedAt: new Date(),
    })
    .where(eq(ingestionJobs.id, ingestionJobId));
}

export async function markJobFailed(
  db: Db,
  ingestionJobId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(ingestionJobs)
    .set({ status: "failed", error: message, updatedAt: new Date() })
    .where(eq(ingestionJobs.id, ingestionJobId));
}
