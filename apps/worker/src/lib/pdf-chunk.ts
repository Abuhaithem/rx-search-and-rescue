/**
 * PDF chunking for providers with small context windows (Haiku 200K,
 * DeepSeek-class 128K): split into ~25-page sub-documents with pdf-lib and
 * re-map absolute page numbers to chunk-relative ones. Providers with large
 * contexts pass maxPages undefined and receive the whole document.
 */
import { PDFDocument } from "pdf-lib";

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
