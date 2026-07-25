/**
 * Supabase Storage download helper (service-role key — worker only, never the
 * browser). Paths stored in the DB are object paths inside a single uploads
 * bucket (SUPABASE_STORAGE_BUCKET, default "uploads").
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface StorageDownloader {
  download(path: string): Promise<Uint8Array>;
}

export interface StorageDeps {
  client?: SupabaseClient;
  bucket?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createStorage(deps: StorageDeps = {}): StorageDownloader {
  const bucket = deps.bucket ?? process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
  const client =
    deps.client ??
    createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );

  return {
    async download(path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) {
        throw new Error(
          `Storage download failed for ${bucket}/${path}: ${error?.message ?? "no data"}`,
        );
      }
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
