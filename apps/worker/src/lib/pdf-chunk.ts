/**
 * PDF splitting with pdf-lib. Formulary ingestion sends one single-page
 * sub-PDF per extraction call (createPageExtractor) — re-sending multi-page
 * chunks per page call paid for the same pages ~25×. chunkPdf remains for
 * callers that genuinely want page-ranged sub-documents (legend front matter,
 * scripts).
 */
import { PDFDocument } from "pdf-lib";

export interface PageExtractor {
  totalPages: number;
  /** Base64 single-page sub-PDF for a 1-indexed absolute page. */
  pageBase64(page: number): Promise<string>;
  /** Base64 sub-PDF covering an inclusive 1-indexed page range. */
  rangeBase64(startPage: number, endPage: number): Promise<string>;
}

/** Loads the source once; each call copies only the requested pages out. */
export async function createPageExtractor(data: Uint8Array): Promise<PageExtractor> {
  const source = await PDFDocument.load(new Uint8Array(data), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const totalPages = source.getPageCount();

  async function rangeBase64(startPage: number, endPage: number): Promise<string> {
    if (startPage < 1 || endPage > totalPages || startPage > endPage) {
      throw new Error(
        `Page range ${startPage}-${endPage} outside document (1-${totalPages})`,
      );
    }
    const target = await PDFDocument.create();
    const indices = Array.from(
      { length: endPage - startPage + 1 },
      (_, i) => startPage - 1 + i,
    );
    const pages = await target.copyPages(source, indices);
    for (const page of pages) target.addPage(page);
    return Buffer.from(await target.save()).toString("base64");
  }

  return {
    totalPages,
    rangeBase64,
    pageBase64: (page) => rangeBase64(page, page),
  };
}

export interface PdfChunk {
  base64: string;
  /** 1-indexed absolute page range (inclusive) this chunk covers. */
  startPage: number;
  endPage: number;
}

export const DEFAULT_CHUNK_PAGES = 25;

export async function chunkPdf(
  data: Uint8Array,
  maxPages?: number,
): Promise<PdfChunk[]> {
  // pdf-lib may mutate/consume its input — hand it a copy.
  const source = await PDFDocument.load(new Uint8Array(data), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const totalPages = source.getPageCount();

  if (maxPages === undefined || totalPages <= maxPages) {
    return [
      {
        base64: Buffer.from(data).toString("base64"),
        startPage: 1,
        endPage: totalPages,
      },
    ];
  }

  const chunks: PdfChunk[] = [];
  for (let start = 0; start < totalPages; start += maxPages) {
    const end = Math.min(start + maxPages, totalPages);
    const target = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await target.copyPages(source, indices);
    for (const page of pages) target.addPage(page);
    const bytes = await target.save();
    chunks.push({
      base64: Buffer.from(bytes).toString("base64"),
      startPage: start + 1,
      endPage: end,
    });
  }
  return chunks;
}

export interface ChunkLocation {
  chunk: PdfChunk;
  /** 1-indexed page number within the chunk's sub-document. */
  relativePage: number;
}

export function chunkForPage(chunks: PdfChunk[], absolutePage: number): ChunkLocation {
  const chunk = chunks.find(
    (c) => absolutePage >= c.startPage && absolutePage <= c.endPage,
  );
  if (!chunk) {
    throw new Error(`No PDF chunk covers page ${absolutePage}`);
  }
  return { chunk, relativePage: absolutePage - chunk.startPage + 1 };
}
