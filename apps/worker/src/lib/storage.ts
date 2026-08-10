/**
 * S3 object storage. Paths stored in the DB are object keys inside the single
 * private bucket (S3_BUCKET). Credentials come from the standard AWS chain:
 * instance role in production, env/SSO locally. The client is injectable so
 * jobs stay testable without network.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StorageClient {
  download(path: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/** Older name; jobs only need download but receive the full client. */
export type StorageDownloader = StorageClient;

export interface StorageDeps {
  client?: Pick<S3Client, "send">;
  bucket?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createStorage(deps: StorageDeps = {}): StorageClient {
  const bucket = deps.bucket ?? requireEnv("S3_BUCKET");
  const client = deps.client ?? new S3Client({});
  const key = (path: string) => path.replace(/^\/+/, "");

  return {
    async download(path) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key(path) }));
        if (!res.Body) throw new Error("empty response body");
        return await res.Body.transformToByteArray();
      } catch (e) {
        throw new Error(
          `Storage download failed for ${bucket}/${path}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },

    async upload(path, bytes, contentType) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key(path),
            Body: bytes,
            ContentType: contentType,
          }),
        );
      } catch (e) {
        throw new Error(
          `Storage upload failed for ${bucket}/${path}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  };
}
