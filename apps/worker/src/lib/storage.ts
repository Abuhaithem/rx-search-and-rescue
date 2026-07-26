/**
 * Supabase Storage download helper (service-role key — worker only, never the
 * browser). Paths stored in the DB are object paths inside the single private
 * bucket from the README setup (SUPABASE_STORAGE_BUCKET, default "documents").
 *
 * Uses the Storage REST API via fetch rather than @supabase/supabase-js: the
 * SDK requires a native WebSocket (Node 22+) for realtime the worker never
 * uses, and file download is a plain authenticated GET.
 */

export interface StorageDownloader {
  download(path: string): Promise<Uint8Array>;
}

export interface StorageDeps {
  fetchImpl?: typeof fetch;
  bucket?: string;
  baseUrl?: string;
  serviceKey?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createStorage(deps: StorageDeps = {}): StorageDownloader {
  const bucket = deps.bucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? "documents";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = (deps.baseUrl ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/$/, "");
  const serviceKey = deps.serviceKey ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return {
    async download(path) {
      const objectPath = path.replace(/^\/+/, "");
      const res = await fetchImpl(
        `${baseUrl}/storage/v1/object/${bucket}/${encodeURI(objectPath)}`,
        { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Storage download failed for ${bucket}/${objectPath}: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
