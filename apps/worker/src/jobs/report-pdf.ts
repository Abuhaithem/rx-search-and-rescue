/**
 * Convert the approved report .docx into a PDF via headless LibreOffice —
 * one source of truth (the golden-tested .docx render), two download
 * formats. Runs at approval time so the PDF is ready before anyone asks.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { analyses, eq } from "@rxsr/db";
import type { ReportPdfJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { createJobDeps, type JobDeps } from "./deps";

const execFileAsync = promisify(execFile);
const CONVERT_TIMEOUT_MS = 120_000;

/** soffice CLI conversion; injectable for tests. */
export async function convertDocxToPdf(docx: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "rxsr-pdf-"));
  try {
    const docxPath = path.join(dir, "report.docx");
    await writeFile(docxPath, docx);
    await execFileAsync(
      "soffice",
      ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, docxPath],
      { timeout: CONVERT_TIMEOUT_MS },
    );
    return new Uint8Array(await readFile(path.join(dir, "report.pdf")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runReportPdf(
  job: ReportPdfJob,
  deps: JobDeps = createJobDeps(),
  convert: (docx: Uint8Array) => Promise<Uint8Array> = convertDocxToPdf,
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Converting report to PDF" });
    const docx = await deps.storage.download(job.docxPath);
    const pdf = await convert(docx);

    const pdfPath = `reports/${job.analysisId}.pdf`;
    await deps.storage.upload(pdfPath, pdf, "application/pdf");
    await db
      .update(analyses)
      .set({ reportPdfPath: pdfPath })
      .where(eq(analyses.id, job.analysisId));

    await markJobDone(db, job.ingestionJobId, {
      message: `PDF ready (${Math.round(pdf.byteLength / 1024)} KB)`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
