/** Client-side pre-checks so oversized files get a toast, not a crash page. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_XLSX_BYTES = 25 * 1024 * 1024;

export function fileTooLarge(file: File | null, maxBytes: number): string | null {
  if (!file || file.size <= maxBytes) return null;
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  return `${file.name} is ${mb(file.size)} MB — the limit is ${mb(maxBytes)} MB`;
}
