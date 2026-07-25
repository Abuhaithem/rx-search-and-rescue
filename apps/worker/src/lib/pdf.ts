/**
 * Text-layer extraction via unpdf. Used as the deterministic cross-check
 * against Claude's vision extraction, never as the primary parser.
 */
import { extractText, getDocumentProxy } from "unpdf";

export interface PdfText {
  totalPages: number;
  /** Per-page text, index 0 = page 1. */
  pages: string[];
}

export interface PdfTextReader {
  extractPageTexts(data: Uint8Array): Promise<PdfText>;
}

export async function extractPageTexts(data: Uint8Array): Promise<PdfText> {
  // pdf.js may transfer/detach the buffer it is given — pass a copy so the
  // caller can keep using the original bytes (e.g. for base64 encoding).
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text };
}

export const pdfTextReader: PdfTextReader = { extractPageTexts };
