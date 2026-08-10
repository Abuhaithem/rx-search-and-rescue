/**
 * scrypt password hashing (node:crypto — no native deps). Stored format:
 * `scrypt:<N>:<r>:<p>:<salt b64>:<key b64>` so parameters can be raised later
 * without invalidating existing hashes.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
// scrypt needs ~128 * N * r bytes; leave headroom over the exact requirement.
const MAX_MEM = 128 * N * r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const params = { N: Number(nStr), r: Number(rStr), p: Number(pStr) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }
  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(keyB64!, "base64");
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length, {
    ...params,
    maxmem: 128 * params.N * params.r * 2,
  });
  return timingSafeEqual(actual, expected);
}
