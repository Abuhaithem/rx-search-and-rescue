import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getDb, ingestionJobs } from "@rxsr/db";

/** Queue names — must mirror apps/worker/src/queues.ts (the worker owns the contract). */
export const QUEUE_NAMES = {
  formularyIngest: "formulary-ingest",
  rxcIntake: "rxc-intake",
  pharmacyDirectory: "pharmacy-directory",
  nppesSeed: "nppes-seed",
  cmsImport: "cms-import",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type IngestionKind =
  | "formulary"
  | "rxc"
  | "pharmacy_directory"
  | "nppes_seed"
  | "cms_import";

// Survive Next.js dev-mode module reloads: one Redis connection + one Queue per name.
const globalCache = globalThis as unknown as {
  __rxsrRedis?: IORedis;
  __rxsrQueues?: Map<QueueName, Queue>;
};

function getConnection(): IORedis {
  globalCache.__rxsrRedis ??= new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
  });
  return globalCache.__rxsrRedis;
}

function getQueue(name: QueueName): Queue {
  globalCache.__rxsrQueues ??= new Map();
  let queue = globalCache.__rxsrQueues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getConnection() });
    globalCache.__rxsrQueues.set(name, queue);
  }
  return queue;
}

/**
 * Bookkeeping row + BullMQ job in one call. The payload builder receives the
 * ingestion_jobs id so the worker can update progress on the same row.
 */
export async function enqueueIngestionJob(options: {
  kind: IngestionKind;
  queue: QueueName;
  targetId?: string | null;
  payload: (ingestionJobId: string) => Record<string, unknown>;
}): Promise<{ ingestionJobId: string }> {
  const [row] = await getDb()
    .insert(ingestionJobs)
    .values({ kind: options.kind, status: "queued", targetId: options.targetId ?? null })
    .returning({ id: ingestionJobs.id });
  if (!row) throw new Error("Failed to create ingestion job");
  await getQueue(options.queue).add(options.queue, options.payload(row.id), { jobId: row.id });
  return { ingestionJobId: row.id };
}
