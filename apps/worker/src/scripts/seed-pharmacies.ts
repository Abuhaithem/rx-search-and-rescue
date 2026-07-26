/**
 * Enqueues the NPPES pharmacy seed job for a state (default ID) through the
 * real pipeline: ingestion_jobs row + BullMQ job on the nppes-seed queue.
 *
 *   pnpm seed:pharmacies [state]
 */
import "@rxsr/db/load-env";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createDb, ingestionJobs } from "@rxsr/db";
import { QUEUE_NAMES, type NppesSeedJob } from "../queues";

async function main(): Promise<void> {
  const state = (
    process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "ID"
  ).toUpperCase();

  const db = createDb();
  const rows = await db
    .insert(ingestionJobs)
    .values({ kind: "nppes_seed", status: "queued" })
    .returning({ id: ingestionJobs.id });
  const ingestionJobId = rows[0]?.id;
  if (!ingestionJobId) throw new Error("ingestion_jobs insert returned no row");

  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue<NppesSeedJob>(QUEUE_NAMES.nppesSeed, { connection });
  await queue.add("nppes-seed", { ingestionJobId, state });

  console.log(`Enqueued NPPES pharmacy seed for state ${state} (job ${ingestionJobId}).`);
  console.log(
    'Make sure the worker is running ("pnpm worker") — progress lands in ingestion_jobs.',
  );
  console.log(
    "Note: the public NPPES API caps one criteria set at ~1200 rows; ZIP-level",
    "lookups during intake fill gaps on demand.",
  );

  await queue.close();
  connection.disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
