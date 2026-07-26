import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { chunkForPage, chunkPdf } from "./pdf-chunk";

async function buildPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]);
  }
  return doc.save();
}

const pagesInChunk = async (base64: string): Promise<number> => {
  const doc = await PDFDocument.load(Buffer.from(base64, "base64"));
  return doc.getPageCount();
};

describe("chunkPdf", () => {
  it("returns the whole document as one chunk when maxPages is undefined", async () => {
    const bytes = await buildPdf(60);
    const chunks = await chunkPdf(bytes);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startPage).toBe(1);
    expect(chunks[0]?.endPage).toBe(60);
    expect(chunks[0]?.base64).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("returns one chunk when the document fits within maxPages", async () => {
    const bytes = await buildPdf(10);
    const chunks = await chunkPdf(bytes, 25);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.endPage).toBe(10);
  });

  it("splits into page-ranged sub-documents", async () => {
    const bytes = await buildPdf(60);
    const chunks = await chunkPdf(bytes, 25);
    expect(chunks.map((c) => [c.startPage, c.endPage])).toEqual([
      [1, 25],
      [26, 50],
      [51, 60],
    ]);
    expect(await pagesInChunk(chunks[0]?.base64 ?? "")).toBe(25);
    expect(await pagesInChunk(chunks[1]?.base64 ?? "")).toBe(25);
    expect(await pagesInChunk(chunks[2]?.base64 ?? "")).toBe(10);
  });
});

describe("chunkForPage", () => {
  it("remaps absolute pages to chunk-relative pages, including boundaries", async () => {
    const bytes = await buildPdf(60);
    const chunks = await chunkPdf(bytes, 25);

    expect(chunkForPage(chunks, 1)).toMatchObject({ relativePage: 1 });
    expect(chunkForPage(chunks, 1).chunk.startPage).toBe(1);

    // Last page of chunk 1 vs first page of chunk 2.
    const p25 = chunkForPage(chunks, 25);
    expect(p25.chunk.startPage).toBe(1);
    expect(p25.relativePage).toBe(25);
    const p26 = chunkForPage(chunks, 26);
    expect(p26.chunk.startPage).toBe(26);
    expect(p26.relativePage).toBe(1);

    const p60 = chunkForPage(chunks, 60);
    expect(p60.chunk.startPage).toBe(51);
    expect(p60.relativePage).toBe(10);
  });

  it("throws for pages outside every chunk", async () => {
    const bytes = await buildPdf(10);
    const chunks = await chunkPdf(bytes, 25);
    expect(() => chunkForPage(chunks, 11)).toThrow(/No PDF chunk covers page 11/);
  });
});
