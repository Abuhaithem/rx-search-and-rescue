/**
 * Bulk-enqueue the client's formulary PDF set through the REAL ingestion
 * pipeline (Storage upload → formularies row → ingestion_jobs row → BullMQ),
 * never seeding entries directly — provenance + QA are non-negotiable.
 *
 *   pnpm ingest:formularies [directory] [--dry-run]
 *
 * Directory layout: <dir>/<CarrierFolder>/<YYYY …>.pdf
 * Idempotent: files whose (carrier, label) already have a formularies row are
 * skipped, so re-runs only pick up new documents.
 */
import "@rxsr/db/load-env";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { and, carriers, createDb, eq, formularies, ingestionJobs } from "@rxsr/db";
import { QUEUE_NAMES, type FormularyIngestJob } from "../queues";
import { createStorage } from "../lib/storage";

const DEFAULT_DIR = "/home/abuhaithem/Downloads/RX/carrier - formulary list";

/** Carrier folder name (lowercased) → carriers.slug. */
export const FOLDER_TO_SLUG: Record<string, string> = {
  "blue cross of idaho": "bci",
  humana: "humana",
  uhc: "uhc",
  cigna: "cigna",
  molina: "molina",
  wellcare: "wellcare",
  silverscript: "silverscript",
};

interface FileResult {
  carrier: string;
  file: string;
  status: "enqueued" | "planned" | "skipped" | "error";
  detail: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const rootDir = args.find((a) => !a.startsWith("--")) ?? DEFAULT_DIR;

  const db = createDb();
  const carrierRows = await db.select().from(carriers);
  const bySlug = new Map(carrierRows.map((c) => [c.slug, c]));

  const storage = dryRun ? null : createStorage();
  const connection = dryRun
    ? null
    : new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
      });
  const queue =
    connection === null
      ? null
      : new Queue<FormularyIngestJob>(QUEUE_NAMES.formularyIngest, { connection });

  const results: FileResult[] = [];

  const folders = readdirSync(rootDir).filter((entry) =>
    statSync(path.join(rootDir, entry)).isDirectory(),
  );

  for (const folder of folders.sort()) {
    const slug = FOLDER_TO_SLUG[folder.toLowerCase()];
    if (!slug) {
      results.push({
        carrier: folder,
        file: "*",
        status: "error",
        detail: `unmapped carrier folder "${folder}" — add it to FOLDER_TO_SLUG`,
      });
      continue;
    }
    const carrier = bySlug.get(slug);
    if (!carrier) {
      throw new Error(
        `Carrier "${slug}" (folder "${folder}") not found in the carriers table — run "pnpm db:seed" first`,
      );
    }

    const pdfs = readdirSync(path.join(rootDir, folder))
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort();

    for (const file of pdfs) {
      const label = file.replace(/\.pdf$/i, "");
      const yearMatch = label.match(/^(\d{4})\b/);
      if (!yearMatch || yearMatch[1] === undefined) {
        results.push({
          carrier: slug,
          file,
          status: "error",
          detail: "no leading 4-digit plan year in filename",
        });
        continue;
      }
      const planYear = Number(yearMatch[1]);

      try {
        const existing = await db
          .select({ id: formularies.id })
          .from(formularies)
          .where(and(eq(formularies.carrierId, carrier.id), eq(formularies.label, label)))
          .limit(1);
        if (existing.length > 0) {
          results.push({
            carrier: slug,
            file,
            status: "skipped",
            detail: "already ingested (same carrier + label)",
          });
          continue;
        }

        if (dryRun || storage === null || queue === null) {
          results.push({
            carrier: slug,
            file,
            status: "planned",
            detail: `would enqueue as ${planYear} "${label}"`,
          });
          continue;
        }

        const bytes = new Uint8Array(readFileSync(path.join(rootDir, folder, file)));
        const storagePath = `formularies/bulk/${randomUUID()}.pdf`;
        await storage.upload(storagePath, bytes, "application/pdf");

        const inserted = await db
          .insert(formularies)
          .values({
            carrierId: carrier.id,
            planYear,
            label,
            sourceFilePath: storagePath,
            status: "ingesting",
          })
          .returning({ id: formularies.id });
        const formularyId = inserted[0]?.id;
        if (!formularyId) throw new Error("formularies insert returned no row");

        const jobRows = await db
          .insert(ingestionJobs)
          .values({ kind: "formulary", status: "queued", targetId: formularyId })
          .returning({ id: ingestionJobs.id });
        const ingestionJobId = jobRows[0]?.id;
        if (!ingestionJobId) throw new Error("ingestion_jobs insert returned no row");

        await queue.add("formulary-ingest", { ingestionJobId, formularyId, storagePath });
        results.push({ carrier: slug, file, status: "enqueued", detail: storagePath });
      } catch (error) {
        results.push({
          carrier: slug,
          file,
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.table(results);
  const tally = (status: FileResult["status"]) =>
    results.filter((r) => r.status === status).length;
  console.log(
    `${dryRun ? "[dry-run] " : ""}enqueued: ${tally("enqueued")}  planned: ${tally("planned")}  skipped: ${tally("skipped")}  errored: ${tally("error")}`,
  );
  if (!dryRun && tally("enqueued") > 0) {
    console.log(
      'Jobs are queued. Make sure the worker is running ("pnpm worker") with the',
      "selected EXTRACTION_PROVIDER's API key set — progress lands in ingestion_jobs.",
    );
  }

  await queue?.close();
  connection?.disconnect();
  process.exit(tally("error") > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
