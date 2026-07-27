/**
 * Server-only route helper. Read-only view of the latest CMS import job so
 * the plans page can show progress via the refresh-poller pattern
 * (PHI-safe: no realtime). Never import from client code.
 */
import { desc, eq, getDb, ingestionJobs } from "@rxsr/db";

export interface CmsImportStatus {
  id: string;
  status: string;
  message: string | null;
  running: boolean;
}

export async function getLatestCmsImport(): Promise<CmsImportStatus | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: ingestionJobs.id,
      status: ingestionJobs.status,
      progress: ingestionJobs.progress,
      error: ingestionJobs.error,
    })
    .from(ingestionJobs)
    .where(eq(ingestionJobs.kind, "cms_import"))
    .orderBy(desc(ingestionJobs.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    message: row.error ?? row.progress?.message ?? null,
    running: row.status === "queued" || row.status === "running",
  };
}
