/**
 * Worker entrypoint. Consumes ingestion queues; the ONLY component that calls
 * external AI/data APIs. All AI extraction happens here, at ingestion time —
 * never in the web request path.
 */
import "@rxsr/db/load-env";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES } from "./queues";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

async function main() {
  const workers: Worker[] = [
    new Worker(
      QUEUE_NAMES.formularyIngest,
      async (job) => {
        const { runFormularyIngest } = await import("./jobs/formulary-ingest");
        return runFormularyIngest(job.data);
      },
      { connection, concurrency: 1 },
    ),
    new Worker(
      QUEUE_NAMES.rxcIntake,
      async (job) => {
        const { runRxcIntake } = await import("./jobs/rxc-intake");
        return runRxcIntake(job.data);
      },
      { connection, concurrency: 2 },
    ),
    new Worker(
      QUEUE_NAMES.pharmacyDirectory,
      async (job) => {
        const { runPharmacyDirectory } = await import("./jobs/pharmacy-directory");
        return runPharmacyDirectory(job.data);
      },
      { connection, concurrency: 1 },
    ),
    new Worker(
      QUEUE_NAMES.nppesSeed,
      async (job) => {
        const { runNppesSeed } = await import("./jobs/nppes-seed");
        return runNppesSeed(job.data);
      },
      { connection, concurrency: 1 },
    ),
  ];

  for (const w of workers) {
    w.on("failed", (job, err) => {
      console.error(`[${w.name}] job ${job?.id} failed:`, err.message);
    });
    w.on("completed", (job) => {
      console.log(`[${w.name}] job ${job.id} completed`);
    });
  }

  console.log(`worker up — queues: ${workers.map((w) => w.name).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
