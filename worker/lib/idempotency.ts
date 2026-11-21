/**
 * Idempotensi mutasi (kontrak G1b bagian 4):
 * - Kunci disimpan per (outlet_id, Idempotency-Key) beserta hash isi request.
 * - Replay kunci + isi sama -> response asli dikembalikan, tanpa efek ganda.
 * - Kunci sama + isi berbeda -> CONFLICT.
 * - Header Idempotency-Key wajib untuk mutasi order & pembayaran.
 */
import { ApiError } from "./errors";

export async function hashRequestBody(body: unknown): Promise<string> {
  const text = JSON.stringify(body ?? null);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function requireIdempotencyKey(
  header: string | undefined,
): string {
  const key = header?.trim();
  if (!key) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Header Idempotency-Key wajib untuk mutasi ini",
      { idempotency_key: "Header Idempotency-Key tidak ada" },
    );
  }
  return key;
}

interface StoredResponse {
  status_code: number;
  response_json: string;
}

/**
 * Cari respons tersimpan untuk kunci ini.
 * Mengembalikan null bila kunci belum pernah dipakai; melempar CONFLICT bila
 * kunci dipakai ulang dengan isi request yang berbeda.
 */
export async function findStoredResponse(
  db: D1Database,
  outletId: string,
  key: string,
  requestHash: string,
): Promise<StoredResponse | null> {
  const row = await db
    .prepare(
      "SELECT request_hash, response_json, status_code FROM idempotency_keys WHERE outlet_id = ? AND key = ?",
    )
    .bind(outletId, key)
    .first<{ request_hash: string | null; response_json: string | null; status_code: number | null }>();
  if (!row) return null;
  if (row.request_hash !== requestHash) {
    throw new ApiError(
      "CONFLICT",
      "Idempotency-Key yang sama dipakai dengan isi request yang berbeda",
    );
  }
  if (row.response_json == null || row.status_code == null) return null;
  return { status_code: row.status_code, response_json: row.response_json };
}

export async function storeResponse(
  db: D1Database,
  outletId: string,
  key: string,
  requestHash: string,
  statusCode: number,
  responseBody: unknown,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO idempotency_keys (id, outlet_id, key, request_hash, response_json, status_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      outletId,
      key,
      requestHash,
      JSON.stringify(responseBody),
      statusCode,
      Date.now(),
    )
    .run();
}
