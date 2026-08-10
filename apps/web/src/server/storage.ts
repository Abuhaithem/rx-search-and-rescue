/**
 * S3 object storage (server only — never import from client code). Paths
 * stored in the DB are object keys inside the single private bucket
 * (S3_BUCKET). Credentials come from the standard AWS chain: instance role in
 * production, env/SSO locally.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not set");
  return bucket;
}

// Cached on globalThis so Next.js dev-mode bundle duplication reuses one client.
function getClient(): S3Client {
  const g = globalThis as typeof globalThis & { __rxsrS3?: S3Client };
  g.__rxsrS3 ??= new S3Client({});
  return g.__rxsrS3;
}

const normalizeKey = (path: string) => path.replace(/^\/+/, "");

export async function uploadObject(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: normalizeKey(path),
        Body: bytes,
        ContentType: contentType,
      }),
    );
  } catch (e) {
    throw new Error(`Upload failed for ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function downloadObject(path: string): Promise<Uint8Array | null> {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: normalizeKey(path) }),
    );
    if (!res.Body) return null;
    return await res.Body.transformToByteArray();
  } catch {
    return null;
  }
}

/** Time-limited GET URL for rendering stored PDFs in the browser. */
export async function createSignedDownloadUrl(
  path: string,
  expiresInSeconds = 60 * 60,
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: normalizeKey(path) }),
    { expiresIn: expiresInSeconds },
  );
}
