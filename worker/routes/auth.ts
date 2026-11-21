/**
 * Rute auth (kontrak G1b):
 * - POST /api/v1/auth/login  — verifikasi nyata ke tabel users (PBKDF2),
 *   menerbitkan token sesi; hash token disimpan di tabel sessions.
 * - POST /api/v1/auth/logout — mencabut sesi aktif.
 * - GET  /api/v1/auth/me     — profil pengguna aktif (tanpa hash).
 *
 * Email unik per outlet (UNIQUE(outlet_id, email)); bila email yang sama ada
 * di beberapa outlet, klien dapat menyertakan outlet_id. Bila kata sandi cocok
 * di lebih dari satu outlet dan outlet_id tidak disertakan, server meminta
 * outlet_id secara eksplisit (VALIDATION_ERROR) agar tidak menebak outlet.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { verifyPassword } from "../lib/password";
import { authMiddleware, createSession, revokeSession } from "../lib/auth";
import { parseWith, readJsonBody } from "../lib/validate";
import type { Env, Role, Variables } from "../lib/types";

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

const loginSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
  outlet_id: z.string().min(1).optional(),
});

interface UserRow {
  id: string;
  outlet_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
}

auth.post("/auth/login", async (c) => {
  const body = parseWith(loginSchema, await readJsonBody(c.req));
  const db = c.env.DB;

  const { results } = await db
    .prepare(
      `SELECT id, outlet_id, name, email, password_hash, role
         FROM users
        WHERE email = ? AND is_active = 1 AND deleted_at IS NULL
          AND (? IS NULL OR outlet_id = ?)`,
    )
    .bind(body.email, body.outlet_id ?? null, body.outlet_id ?? null)
    .all<UserRow>();

  const matches: UserRow[] = [];
  for (const row of results) {
    if (await verifyPassword(body.password, row.password_hash)) {
      matches.push(row);
    }
  }

  if (matches.length === 0) {
    throw new ApiError("UNAUTHORIZED", "Email atau kata sandi tidak valid");
  }
  if (matches.length > 1) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Email terdaftar di beberapa outlet; sertakan outlet_id",
      { outlet_id: "Wajib diisi karena email terdaftar di lebih dari satu outlet" },
    );
  }

  const user = matches[0] as UserRow;
  const session = await createSession(db, {
    id: user.id,
    outlet_id: user.outlet_id,
  });

  return c.json(
    successEnvelope(
      {
        token: session.token,
        expires_at: session.expiresAt,
        user: {
          id: user.id,
          outlet_id: user.outlet_id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
      c.get("requestId"),
    ),
    200,
  );
});

auth.use("/auth/logout", authMiddleware);
auth.use("/auth/me", authMiddleware);

auth.post("/auth/logout", async (c) => {
  const user = c.get("user");
  await revokeSession(c.env.DB, user.session_id);
  return c.json(
    successEnvelope({ logged_out: true }, c.get("requestId")),
    200,
  );
});

auth.get("/auth/me", (c) => {
  const user = c.get("user");
  return c.json(
    successEnvelope(
      {
        id: user.id,
        outlet_id: user.outlet_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      c.get("requestId"),
    ),
    200,
  );
});

export default auth;
