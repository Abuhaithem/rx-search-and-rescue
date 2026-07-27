/**
 * Supabase Storage helper (service-role key — worker only, never the
 * browser). Paths stored in the DB are object paths inside the single private
 * bucket from the README setup (SUPABASE_STORAGE_BUCKET, default "documents").
 *
 * Uses the Storage REST API via fetch rather than @supabase/supabase-js: the
 * SDK requires a native WebSocket (Node 22+) for realtime the worker never
 * uses, and object download/upload are plain authenticated requests.
 */

export interface StorageClient {
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/** Older name; jobs only need download but receive the full client. */
export type StorageDownloader = StorageClient;

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

export function createStorage(deps: StorageDeps = {}): StorageClient {
  const bucket = deps.bucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? "documents";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = (deps.baseUrl ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/$/, "");
  const serviceKey = deps.serviceKey ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const objectUrl = (path: string) =>
    `${baseUrl}/storage/v1/object/${bucket}/${encodeURI(path.replace(/^\/+/, ""))}`;

  return {
    async download(path) {
      const res = await fetchImpl(objectUrl(path), {
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Storage download failed for ${bucket}/${path}: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async upload(path, bytes, contentType) {
      const res = await fetchImpl(objectUrl(path), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": contentType,
          "x-upsert": "false",
        },
        body: bytes,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Storage upload failed for ${bucket}/${path}: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
      }
    },
  };
}
