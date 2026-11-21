/**
 * Rute shift kas (kontrak G1b):
 * - POST /api/v1/shifts/open         — satu shift terbuka per (outlet, kasir);
 *   membuka lagi saat masih ada yang terbuka -> CONFLICT.
 * - POST /api/v1/shifts/:id/close    — counted_cash wajib; server menghitung
 *   expected_cash (modal awal + mutasi kas + pembayaran tunai settled pada
 *   shift) dan difference = counted - expected.
 * - GET  /api/v1/shifts/current      — shift terbuka milik pengguna aktif.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { parseWith, readJsonBody } from "../lib/validate";
import type { Env, Variables } from "../lib/types";

const shifts = new Hono<{ Bindings: Env; Variables: Variables }>();

export interface ShiftRow {
  id: string; outlet_id: string; cashier_id: string | null;
  opened_at: number; closed_at: number | null; opening_cash: number;
  expected_cash: number | null; counted_cash: number | null;
  difference: number | null; status: string; version: number;
}

const shiftOut = (r: ShiftRow) => ({
  id: r.id, outlet_id: r.outlet_id, cashier_id: r.cashier_id,
  opened_at: r.opened_at, closed_at: r.closed_at,
  opening_cash: r.opening_cash, expected_cash: r.expected_cash,
  counted_cash: r.counted_cash, difference: r.difference,
  status: r.status, version: r.version,
});

export async function findOpenShift(
  db: D1Database, outletId: string, cashierId: string,
): Promise<ShiftRow | null> {
  return db
    .prepare(
      "SELECT * FROM cash_shifts WHERE outlet_id = ? AND cashier_id = ? AND status = 'open' AND deleted_at IS NULL ORDER BY opened_at DESC LIMIT 1",
    )
    .bind(outletId, cashierId)
    .first<ShiftRow>();
}

/** Total pembayaran tunai yang sudah settled pada shift ini. */
export async function settledCashTotal(
  db: D1Database, outletId: string, shiftId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount - change_amount), 0) AS total
         FROM payments
        WHERE outlet_id = ? AND shift_id = ? AND method = 'cash'
          AND status = 'settled' AND deleted_at IS NULL`,
    )
    .bind(outletId, shiftId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Total mutasi kas manual (in - out; adjustment bertanda mengikuti amount). */
export async function cashMovementsTotal(
  db: D1Database, shiftId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'out' THEN -amount ELSE amount END), 0) AS total
         FROM cash_movements WHERE shift_id = ?`,
    )
    .bind(shiftId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

const openSchema = z.object({
  opening_cash: z.number().int().min(0).default(0),
});

shifts.post("/shifts/open", async (c) => {
  const user = c.get("user");
  const body = parseWith(openSchema, await readJsonBody(c.req));
  const existing = await findOpenShift(c.env.DB, user.outlet_id, user.id);
  if (existing) {
    throw new ApiError("CONFLICT", "Masih ada shift terbuka untuk kasir ini", {
      shift_id: existing.id,
    });
  }
  const t = Date.now();
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO cash_shifts (id, outlet_id, cashier_id, opened_at, closed_at, opening_cash,
              expected_cash, counted_cash, difference, status, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, 'open', ?, ?, NULL, 1)`,
    )
    .bind(id, user.outlet_id, user.id, t, body.opening_cash, t, t)
    .run();
  const row = await c.env.DB
    .prepare("SELECT * FROM cash_shifts WHERE id = ?")
    .bind(id)
    .first<ShiftRow>();
  return c.json(successEnvelope(shiftOut(row as ShiftRow), c.get("requestId")), 201);
});

const closeSchema = z.object({
  counted_cash: z.number().int().min(0, "Uang terhitung wajib diisi"),
});

shifts.post("/shifts/:id/close", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = parseWith(closeSchema, await readJsonBody(c.req));
  const row = await c.env.DB
    .prepare("SELECT * FROM cash_shifts WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(id, user.outlet_id)
    .first<ShiftRow>();
  if (!row) throw new ApiError("NOT_FOUND", "Shift tidak ditemukan");
  if (row.status !== "open") {
    throw new ApiError("CONFLICT", "Shift sudah ditutup");
  }
  const cashSales = await settledCashTotal(c.env.DB, user.outlet_id, id);
  const movements = await cashMovementsTotal(c.env.DB, id);
  const expected = row.opening_cash + movements + cashSales;
  const difference = body.counted_cash - expected;
  const t = Date.now();
  await c.env.DB
    .prepare(
      `UPDATE cash_shifts SET closed_at = ?, expected_cash = ?, counted_cash = ?, difference = ?,
              status = 'closed', updated_at = ?, version = version + 1 WHERE id = ?`,
    )
    .bind(t, expected, body.counted_cash, difference, t, id)
    .run();
  const updated = await c.env.DB
    .prepare("SELECT * FROM cash_shifts WHERE id = ?")
    .bind(id)
    .first<ShiftRow>();
  return c.json(
    successEnvelope(
      { ...shiftOut(updated as ShiftRow), cash_sales_total: cashSales, cash_movements_total: movements },
      c.get("requestId"),
    ),
    200,
  );
});

shifts.get("/shifts/current", async (c) => {
  const user = c.get("user");
  const row = await findOpenShift(c.env.DB, user.outlet_id, user.id);
  if (!row) throw new ApiError("SHIFT_NOT_OPEN", "Tidak ada shift terbuka untuk kasir ini");
  return c.json(successEnvelope(shiftOut(row), c.get("requestId")), 200);
});

export default shifts;
