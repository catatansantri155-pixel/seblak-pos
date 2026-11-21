/**
 * Hash kata sandi PBKDF2 (WebCrypto) — dipakai untuk users.password_hash.
 *
 * Format tersimpan: pbkdf2$<iterasi>$<salt base64>$<hash base64>
 * - KDF: PBKDF2 dengan SHA-256, salt acak 16 byte, kunci turunan 32 byte.
 * - Iterasi default 100.000 (di bawah batas CPU Workers per request, dan
 *   tercatat di string sehingga bisa dinaikkan tanpa memutus hash lama).
 */

const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Hash kata sandi baru; menghasilkan string format pbkdf2$iterasi$salt$hash. */
export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

/** Perbandingan byte tahan-timing (panjang harus sama). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Verifikasi kata sandi terhadap string hash tersimpan. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64ToBytes(parts[2] ?? "");
    expected = base64ToBytes(parts[3] ?? "");
  } catch {
    return false;
  }
  if (expected.length !== KEY_BYTES) return false;
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}
