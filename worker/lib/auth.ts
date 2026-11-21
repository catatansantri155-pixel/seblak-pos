/**
 * Sesi & autentikasi Seblak POS.
 *
 * - Token sesi: 32 byte acak, dikirim ke klien sebagai base64url.
 * - Yang disimpan di tabel sessions hanya HASH SHA-256 token (token_hash),
 *   jadi kebocoran database tidak membocorkan token yang berlaku.
 * - Middleware auth memasang konteks pengguna (id, outlet_id, role) ke
 *   variabel Hono "user"; semua query rute terproteksi ter-scope outlet_id
 *   dari konteks ini, tidak pernah dari input klien.
 */
import type { Context, MiddlewareHandler } from "hono";
import { ApiError } from "./errors";
import type { AuthUser, Env, Role, Variables } from "./types";

/** Masa berlaku sesi: 24 jam (epoch ms). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Buat token sesi baru dan simpan hash-nya; mengembalikan token mentah. */
export async function createSession(
  db: D1Database,
  user: { id: string; outlet_id: string },
  now: number = Date.now(),
): Promise<{ token: string; sessionId: string; expiresAt: number }> {
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID();
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare(
      "INSERT INTO sessions (id, outlet_id, user_id, token_hash, created_at, expires_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(sessionId, user.outlet_id, user.id, tokenHash, now, expiresAt, now)
    .run();
  return { token, sessionId, expiresAt };
}

/** Cabut sesi (logout). Idempoten: sesi yang sudah dicabut tetap dicabut. */
export async function revokeSession(
  db: D1Database,
  sessionId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(Date.now(), sessionId)
    .run();
}

interface SessionUserRow {
  session_id: string;
  expires_at: number;
  revoked_at: number | null;
  user_id: string;
  outlet_id: string;
  role: Role;
  name: string;
  email: string;
  user_active: number;
  user_deleted_at: number | null;
}

/** Resolusi token Bearer -> pengguna; null bila tidak sah/kedaluwarsa/dicabut. */
export async function resolveSessionUser(
  db: D1Database,
  token: string,
  now: number = Date.now(),
): Promise<AuthUser | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
              u.id AS user_id, u.outlet_id, u.role, u.name, u.email,
              u.is_active AS user_active, u.deleted_at AS user_deleted_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionUserRow>();
  if (!row) return null;
  if (row.revoked_at != null) return null;
  if (row.expires_at <= now) return null;
  if (row.user_active !== 1 || row.user_deleted_at != null) return null;
  return {
    id: row.user_id,
    outlet_id: row.outlet_id,
    role: row.role,
    name: row.name,
    email: row.email,
    session_id: row.session_id,
  };
}

/** Middleware: wajib Authorization: Bearer <token sesi> yang sah. */
export const authMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !match[1]) {
    throw new ApiError("UNAUTHORIZED", "Token sesi tidak ada atau tidak sah");
  }
  const user = await resolveSessionUser(c.env.DB, match[1]);
  if (!user) {
    throw new ApiError(
      "UNAUTHORIZED",
      "Sesi tidak sah, sudah dicabut, atau kedaluwarsa",
    );
  }
  c.set("user", user);
  await next();
};

/** Guard peran: lempar FORBIDDEN bila peran pengguna tidak termasuk daftar. */
export function requireRole(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  ...roles: Role[]
): AuthUser {
  const user = c.get("user");
  if (!roles.includes(user.role)) {
    throw new ApiError(
      "FORBIDDEN",
      `Peran ${user.role} tidak berhak melakukan aksi ini`,
    );
  }
  return user;
}
