/**
 * Streaming I/O for CMS quarterly ZIP archives. The national files are large
 * (pharmacy networks alone can be tens of millions of lines), so everything
 * is streamed: download → temp file → per-entry line streaming via unzipper.
 * Nothing is buffered beyond the scoped candidate rows.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import readline from "node:readline";
import unzipper from "unzipper";
import {
  buildHeaderIndex,
  classifyCmsEntry,
  COST_FILE_HEADERS,
  COST_REQUIRED_FIELDS,
  NETWORK_FILE_HEADERS,
  NETWORK_REQUIRED_FIELDS,
  parseCostLine,
  parseNetworkLine,
  type CmsCostRow,
  type CmsEntryKind,
  type CmsNetworkRow,
} from "./cms";

export interface DownloadedArchive {
  zipPath: string;
  cleanup(): Promise<void>;
}

export async function downloadToTemp(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DownloadedArchive> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cms-import-"));
  const zipPath = path.join(dir, "cms.zip");
  const response = await fetchImpl(sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`CMS download failed: HTTP ${response.status} for ${sourceUrl}`);
  }
  // Node fetch bodies are web streams; cast for Readable.fromWeb.
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(zipPath),
  );
  return { zipPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface CmsScanOptions {
  /** contractPlanKey values ("H1350-033") we import rows for. */
  targetKeys: Set<string>;
  /**
   * NPIs already in our pharmacies table. The national network file carries
   * every pharmacy in the country (~60k+/plan); we only care about the
   * NPPES-seeded / client-referenced set, so everything else is dropped at
   * scan time to keep memory flat.
   */
  knownNpis: Set<string>;
  onProgress?(message: string): void | Promise<void>;
}

export interface CmsScanResult {
  entries: Array<{ name: string; kind: CmsEntryKind }>;
  networks: {
    fileFound: boolean;
    linesScanned: number;
    malformed: number;
    rows: CmsNetworkRow[]; // scoped to targetKeys + knownNpis + retail
  };
  costs: {
    fileFound: boolean;
    linesScanned: number;
    malformed: number;
    filtered: number;
    rows: CmsCostRow[]; // scoped to targetKeys
  };
}

const PROGRESS_EVERY_LINES = 250_000;

async function eachLine(
  stream: NodeJS.ReadableStream,
  onLine: (fields: string[], lineNumber: number) => void,
): Promise<void> {
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    onLine(line.split("|"), lineNumber);
  }
}

export async function scanCmsZip(
  zipPath: string,
  options: CmsScanOptions,
): Promise<CmsScanResult> {
  const directory = await unzipper.Open.file(zipPath);
  const result: CmsScanResult = {
    entries: [],
    networks: { fileFound: false, linesScanned: 0, malformed: 0, rows: [] },
    costs: { fileFound: false, linesScanned: 0, malformed: 0, filtered: 0, rows: [] },
  };

  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    const kind = classifyCmsEntry(entry.path);
    result.entries.push({ name: entry.path, kind });
  }
  await options.onProgress?.(
    `Archive contains: ${result.entries.map((e) => `${e.name} [${e.kind}]`).join(", ")}`,
  );

  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    const kind = classifyCmsEntry(entry.path);

    if (kind === "pharmacy_networks") {
      result.networks.fileFound = true;
      let headerIndex: ReturnType<typeof buildHeaderIndex<typeof NETWORK_FILE_HEADERS>> | null =
        null;
      await eachLine(entry.stream(), (fields, lineNumber) => {
        if (lineNumber === 1) {
          headerIndex = buildHeaderIndex(fields, NETWORK_FILE_HEADERS, NETWORK_REQUIRED_FIELDS);
          return;
        }
        if (!headerIndex) return;
        result.networks.linesScanned += 1;
        if (result.networks.linesScanned % PROGRESS_EVERY_LINES === 0) {
          void options.onProgress?.(
            `Pharmacy networks: ${result.networks.linesScanned} lines scanned, ${result.networks.rows.length} matched`,
          );
        }
        const row = parseNetworkLine(fields, headerIndex);
        if (row === null) {
          result.networks.malformed += 1;
          return;
        }
        // Retail network status only — mail-order-only pharmacies aren't a
        // client's preferred retail pharmacy.
        if (!row.isRetail) return;
        if (!options.targetKeys.has(row.key)) return;
        if (!options.knownNpis.has(row.npi)) return;
        result.networks.rows.push(row);
      });
    }

    if (kind === "beneficiary_costs") {
      result.costs.fileFound = true;
      let headerIndex: ReturnType<typeof buildHeaderIndex<typeof COST_FILE_HEADERS>> | null =
        null;
      await eachLine(entry.stream(), (fields, lineNumber) => {
        if (lineNumber === 1) {
          headerIndex = buildHeaderIndex(fields, COST_FILE_HEADERS, COST_REQUIRED_FIELDS);
          return;
        }
        if (!headerIndex) return;
        result.costs.linesScanned += 1;
        const parsed = parseCostLine(fields, headerIndex);
        if (parsed.kind === "malformed") {
          result.costs.malformed += 1;
          return;
        }
        if (parsed.kind === "filtered") {
          result.costs.filtered += 1;
          return;
        }
        if (!options.targetKeys.has(parsed.row.key)) return;
        result.costs.rows.push(parsed.row);
      });
    }
  }

  return result;
}
