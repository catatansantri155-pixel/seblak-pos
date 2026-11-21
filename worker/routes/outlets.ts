/**
 * Rute profil outlet (gate G4):
 * - GET   /api/v1/outlets/me — profil outlet dari sesi (semua peran login).
 *   Inilah sumber nama outlet untuk header aplikasi (sebelumnya klien hanya
 *   memegang outlet_id dari /auth/me).
 * - PATCH /api/v1/outlets/me — owner saja; hanya kolom yang benar-benar ada
 *   di tabel outlets (0001): name, address, phone, tax_rate_bp, currency.
 *   Skema outlets memang minim (tanpa jam operasional/logo/dst.) — endpoint
 *   mengembalikan apa adanya tanpa kolom khayalan.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { requireRole } from "../lib/auth";
import { parseWith, readJsonBody } from "../lib/validate";
import type { Env, Variables } from "../lib/types";

const outlets = new Hono<{ Bindings: Env; Variables: Variables }>();

interface OutletRow {
  id: string; name: string; address: string | null; phone: string | null;
  tax_rate_bp: number; currency: string; is_active: number;
  created_at: number; updated_at: number; version: number;
}

const outletOut = (r: OutletRow) => ({
  id: r.id, name: r.name, address: r.address, phone: r.phone,
  tax_rate_bp: r.tax_rate_bp, currency: r.currency,
  is_active: r.is_active === 1,
  created_at: r.created_at, updated_at: r.updated_at, version: r.version,
});

async function fetchOutlet(
  db: D1Database, outletId: string,
): Promise<OutletRow> {
  const row = await db
    .prepare("SELECT * FROM outlets WHERE id = ? AND deleted_at IS NULL")
    .bind(outletId)
    .first<OutletRow>();
  if (!row) throw new ApiError("NOT_FOUND", "Outlet tidak ditemukan");
  return row;
}

outlets.get("/outlets/me", async (c) => {
  const user = c.get("user");
  const row = await fetchOutlet(c.env.DB, user.outlet_id);
  return c.json(successEnvelope(outletOut(row), c.get("requestId")), 200);
});

const patchOutletSchema = z.object({
  name: z.string().min(1, "Nama outlet tidak boleh kosong").optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  tax_rate_bp: z.number().int().min(0).max(10_000).optional(),
  currency: z.string().min(1).optional(),
});

outlets.patch("/outlets/me", async (c) => {
  const user = requireRole(c, "owner");
  const db = c.env.DB;
  const body = parseWith(patchOutletSchema, await readJsonBody(c.req));
  const current = await fetchOutlet(db, user.outlet_id);
  const t = Date.now();
  await db
    .prepare(
      `UPDATE outlets SET name = ?, address = ?, phone = ?, tax_rate_bp = ?,
              currency = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    )
    .bind(
      body.name ?? current.name,
      body.address !== undefined ? body.address : current.address,
      body.phone !== undefined ? body.phone : current.phone,
      body.tax_rate_bp ?? current.tax_rate_bp,
      body.currency ?? current.currency,
      t,
      current.id,
    )
    .run();
  const updated = await fetchOutlet(db, user.outlet_id);
  return c.json(successEnvelope(outletOut(updated), c.get("requestId")), 200);
});

export default outlets;
