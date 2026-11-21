/**
 * Rute manajemen pengguna (gate G4):
 * - GET  /api/v1/users                    — owner & manager (tanpa hash).
 * - POST /api/v1/users                    — owner saja. Email unik per outlet
 *   (duplikat -> CONFLICT); kata sandi di-hash PBKDF2 (worker/lib/password).
 * - PATCH /api/v1/users/:id               — owner saja: ubah nama/peran dan
 *   nonaktifkan (is_active = 0). Menonaktifkan pengguna MENCABUT semua
 *   sesinya yang masih aktif.
 * - POST /api/v1/users/:id/reset-password — owner saja: pasang kata sandi
 *   baru (hash PBKDF2) dan cabut semua sesi pengguna itu.
 *
 * resolveSessionUser juga menolak pengguna nonaktif/terhapus, jadi pencabutan
 * sesi + is_active = 0 menutup akses dari dua sisi. Owner tidak bisa
 * menonaktifkan akunnya sendiri (mencegah outlet terkunci tanpa owner).
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { requireRole } from "../lib/auth";
import { hashPassword } from "../lib/password";
import { parsePagination, parseWith, readJsonBody } from "../lib/validate";
import type { Env, Role, Variables } from "../lib/types";

const users = new Hono<{ Bindings: Env; Variables: Variables }>();

interface UserRow {
  id: string; outlet_id: string; name: string; email: string; role: Role;
  is_active: number; created_at: number; updated_at: number; version: number;
}

const userOut = (r: UserRow) => ({
  id: r.id, outlet_id: r.outlet_id, name: r.name, email: r.email,
  role: r.role, is_active: r.is_active === 1,
  created_at: r.created_at, updated_at: r.updated_at, version: r.version,
});

async function fetchUser(
  db: D1Database, outletId: string, id: string,
): Promise<UserRow> {
  const row = await db
    .prepare("SELECT * FROM users WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(id, outletId)
    .first<UserRow>();
  if (!row) throw new ApiError("NOT_FOUND", "Pengguna tidak ditemukan");
  return row;
}

async function revokeAllSessions(
  db: D1Database, userId: string,
): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(Date.now(), userId)
    .run();
}

users.get("/users", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const db = c.env.DB;
  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE outlet_id = ? AND deleted_at IS NULL")
    .bind(user.outlet_id)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(
      `SELECT * FROM users WHERE outlet_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    )
    .bind(user.outlet_id, limit, offset)
    .all<UserRow>();
  return c.json(
    successEnvelope(results.map(userOut), c.get("requestId"), {
      page, per_page: perPage, total: total?.n ?? 0,
    }),
    200,
  );
});

const createUserSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi"),
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(6, "Kata sandi minimal 6 karakter"),
  role: z.enum(["owner", "manager", "cashier", "kitchen"]),
});

users.post("/users", async (c) => {
  const user = requireRole(c, "owner");
  const db = c.env.DB;
  const body = parseWith(createUserSchema, await readJsonBody(c.req));

  const dup = await db
    .prepare("SELECT id FROM users WHERE outlet_id = ? AND email = ?")
    .bind(user.outlet_id, body.email)
    .first<{ id: string }>();
  if (dup) {
    throw new ApiError("CONFLICT", "Email sudah terdaftar di outlet ini", {
      email: body.email,
    });
  }

  const t = Date.now();
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  await db
    .prepare(
      `INSERT INTO users (id, outlet_id, name, email, password_hash, role, pin_hash,
              is_active, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, NULL, 1)`,
    )
    .bind(id, user.outlet_id, body.name, body.email, passwordHash, body.role, t, t)
    .run();
  const row = await fetchUser(db, user.outlet_id, id);
  return c.json(successEnvelope(userOut(row), c.get("requestId")), 201);
});

const patchUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["owner", "manager", "cashier", "kitchen"]).optional(),
  is_active: z.boolean().optional(),
});

users.patch("/users/:id", async (c) => {
  const user = requireRole(c, "owner");
  const db = c.env.DB;
  const body = parseWith(patchUserSchema, await readJsonBody(c.req));
  const target = await fetchUser(db, user.outlet_id, c.req.param("id"));

  if (body.is_active === false && target.id === user.id) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Tidak dapat menonaktifkan akun sendiri",
      { is_active: "Owner tidak bisa menonaktifkan akunnya sendiri" },
    );
  }

  const t = Date.now();
  await db
    .prepare(
      `UPDATE users SET name = ?, role = ?, is_active = ?, updated_at = ?,
              version = version + 1 WHERE id = ?`,
    )
    .bind(
      body.name ?? target.name,
      body.role ?? target.role,
      body.is_active === undefined ? target.is_active : body.is_active ? 1 : 0,
      t,
      target.id,
    )
    .run();

  if (body.is_active === false) {
    await revokeAllSessions(db, target.id);
  }
  const updated = await fetchUser(db, user.outlet_id, target.id);
  return c.json(successEnvelope(userOut(updated), c.get("requestId")), 200);
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, "Kata sandi minimal 6 karakter"),
});

users.post("/users/:id/reset-password", async (c) => {
  const user = requireRole(c, "owner");
  const db = c.env.DB;
  const body = parseWith(resetPasswordSchema, await readJsonBody(c.req));
  const target = await fetchUser(db, user.outlet_id, c.req.param("id"));
  const passwordHash = await hashPassword(body.password);
  const t = Date.now();
  await db
    .prepare(
      "UPDATE users SET password_hash = ?, updated_at = ?, version = version + 1 WHERE id = ?",
    )
    .bind(passwordHash, t, target.id)
    .run();
  await revokeAllSessions(db, target.id);
  return c.json(
    successEnvelope(
      { id: target.id, password_reset: true, sessions_revoked: true },
      c.get("requestId"),
    ),
    200,
  );
});

export default users;
