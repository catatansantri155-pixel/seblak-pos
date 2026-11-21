/**
 * Rute stok lanjutan (kontrak G1b modul Inventaris):
 * - GET  /api/v1/stock/balances  — saldo kini semua produk is_stock_tracked
 *   (saldo SELALU agregat stock_movements; tidak ada kolom saldo yang
 *   diubah langsung — prinsip skema G1a #7). low_stock ditandai bila
 *   produk punya ambang min_stock > 0 (migrasi 0009) dan saldo <= ambang.
 * - GET  /api/v1/stock/movements — riwayat gerakan; filter product_id,
 *   type, from, to (epoch ms); pagination kontrak G1b.
 * - POST /api/v1/stock/movements — gerakan manual; Idempotency-Key wajib.
 *   type mengikuti CHECK skema: purchase | adjustment | waste | return.
 *   qty_delta bertanda: purchase/return harus positif, waste harus negatif,
 *   adjustment boleh dua arah tapi tidak nol. note WAJIB untuk adjustment
 *   & waste (kontrak G1b). Peran: purchase boleh owner/manager/cashier;
 *   adjustment, waste, return hanya owner/manager. Gerakan keluar yang
 *   membuat saldo negatif ditolak INSUFFICIENT_STOCK.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { requireRole } from "../lib/auth";
import { parsePagination, parseWith, readJsonBody } from "../lib/validate";
import {
  findStoredResponse,
  hashRequestBody,
  requireIdempotencyKey,
  storeResponse,
} from "../lib/idempotency";
import type { Env, Variables } from "../lib/types";

const stock = new Hono<{ Bindings: Env; Variables: Variables }>();

interface MovementRow {
  id: string; outlet_id: string; product_id: string; batch_id: string | null;
  type: string; qty_delta: number; ref_type: string | null; ref_id: string | null;
  note: string | null; created_by: string | null; created_at: number;
}

const movementOut = (r: MovementRow) => ({
  id: r.id, outlet_id: r.outlet_id, product_id: r.product_id,
  batch_id: r.batch_id, type: r.type, qty_delta: r.qty_delta,
  ref_type: r.ref_type, ref_id: r.ref_id, note: r.note,
  created_by: r.created_by, created_at: r.created_at,
});

export async function productBalance(
  db: D1Database, outletId: string, productId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(qty_delta), 0) AS bal FROM stock_movements WHERE outlet_id = ? AND product_id = ?")
    .bind(outletId, productId)
    .first<{ bal: number }>();
  return row?.bal ?? 0;
}

// --------------------------------------------------------------- balances

stock.get("/stock/balances", async (c) => {
  const user = c.get("user");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const db = c.env.DB;

  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM products WHERE outlet_id = ? AND is_stock_tracked = 1 AND deleted_at IS NULL")
    .bind(user.outlet_id)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(
      `SELECT p.id AS product_id, p.name, p.sku, p.category_id, p.min_stock,
              COALESCE(SUM(sm.qty_delta), 0) AS balance
         FROM products p
         LEFT JOIN stock_movements sm
           ON sm.product_id = p.id AND sm.outlet_id = p.outlet_id
        WHERE p.outlet_id = ? AND p.is_stock_tracked = 1 AND p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.name ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(user.outlet_id, limit, offset)
    .all<{
      product_id: string; name: string; sku: string | null;
      category_id: string | null; min_stock: number; balance: number;
    }>();

  return c.json(
    successEnvelope(
      results.map((r) => ({
        product_id: r.product_id,
        name: r.name,
        sku: r.sku,
        category_id: r.category_id,
        balance: r.balance,
        min_stock: r.min_stock,
        low_stock: r.min_stock > 0 && r.balance <= r.min_stock,
      })),
      c.get("requestId"),
      { page, per_page: perPage, total: total?.n ?? 0 },
    ),
    200,
  );
});

// -------------------------------------------------------------- movements

stock.get("/stock/movements", async (c) => {
  const user = c.get("user");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const conds: string[] = ["outlet_id = ?"];
  const binds: unknown[] = [user.outlet_id];
  const productId = c.req.query("product_id");
  if (productId) { conds.push("product_id = ?"); binds.push(productId); }
  const type = c.req.query("type");
  if (type) { conds.push("type = ?"); binds.push(type); }
  const from = c.req.query("from");
  if (from && Number.isFinite(Number(from))) { conds.push("created_at >= ?"); binds.push(Number(from)); }
  const to = c.req.query("to");
  if (to && Number.isFinite(Number(to))) { conds.push("created_at <= ?"); binds.push(Number(to)); }
  const whereSql = conds.join(" AND ");
  const db = c.env.DB;
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM stock_movements WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(`SELECT * FROM stock_movements WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<MovementRow>();
  return c.json(
    successEnvelope(results.map(movementOut), c.get("requestId"), {
      page, per_page: perPage, total: total?.n ?? 0,
    }),
    200,
  );
});

const createMovementSchema = z.object({
  product_id: z.string().min(1, "Produk wajib diisi"),
  type: z.enum(["purchase", "adjustment", "waste", "return"]),
  qty_delta: z.number().int("qty_delta harus bilangan bulat"),
  note: z.string().nullable().optional(),
  batch_id: z.string().min(1).nullable().optional(),
});

stock.post("/stock/movements", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const rawBody = await readJsonBody(c.req);
  const body = parseWith(createMovementSchema, rawBody);

  // Peran per tipe gerakan (aturan brief G4a).
  if (body.type === "purchase") {
    requireRole(c, "owner", "manager", "cashier");
  } else {
    requireRole(c, "owner", "manager");
  }

  // Aturan tanda & note.
  const details: Record<string, string> = {};
  if (body.qty_delta === 0) {
    details.qty_delta = "qty_delta tidak boleh nol";
  }
  if ((body.type === "purchase" || body.type === "return") && body.qty_delta < 0) {
    details.qty_delta = `Gerakan ${body.type} harus bernilai positif`;
  }
  if (body.type === "waste" && body.qty_delta > 0) {
    details.qty_delta = "Gerakan waste harus bernilai negatif (stok keluar)";
  }
  if (
    (body.type === "adjustment" || body.type === "waste") &&
    (!body.note || body.note.trim() === "")
  ) {
    details.note = `Catatan wajib diisi untuk gerakan ${body.type}`;
  }
  if (Object.keys(details).length > 0) {
    throw new ApiError("VALIDATION_ERROR", "Gerakan stok tidak valid", details);
  }

  const product = await db
    .prepare("SELECT id, name FROM products WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(body.product_id, user.outlet_id)
    .first<{ id: string; name: string }>();
  if (!product) {
    throw new ApiError("VALIDATION_ERROR", "Produk tidak ditemukan", {
      product_id: "Produk tidak ditemukan di outlet ini",
    });
  }

  const idemKey = requireIdempotencyKey(c.req.header("Idempotency-Key"));
  const scopedKey = `stock:${idemKey}`;
  const requestHash = await hashRequestBody(rawBody);
  const stored = await findStoredResponse(db, user.outlet_id, scopedKey, requestHash);
  if (stored) {
    return c.json(
      successEnvelope(JSON.parse(stored.response_json), c.get("requestId")),
      stored.status_code as 201,
    );
  }

  // Saldo tidak boleh menjadi negatif karena gerakan keluar manual.
  const balanceBefore = await productBalance(db, user.outlet_id, body.product_id);
  const balanceAfter = balanceBefore + body.qty_delta;
  if (balanceAfter < 0) {
    throw new ApiError("INSUFFICIENT_STOCK", "Saldo stok tidak cukup untuk gerakan keluar ini", {
      product_id: body.product_id,
      product_name: product.name,
      available: balanceBefore,
      requested_out: -body.qty_delta,
    });
  }

  const t = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO stock_movements (id, outlet_id, product_id, batch_id, type, qty_delta,
              ref_type, ref_id, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', NULL, ?, ?, ?)`,
    )
    .bind(
      id, user.outlet_id, body.product_id, body.batch_id ?? null, body.type,
      body.qty_delta, body.note ?? null, user.id, t,
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM stock_movements WHERE id = ?")
    .bind(id)
    .first<MovementRow>();
  const data = {
    movement: movementOut(row as MovementRow),
    balance_before: balanceBefore,
    balance_after: balanceAfter,
  };
  await storeResponse(db, user.outlet_id, scopedKey, requestHash, 201, data);
  return c.json(successEnvelope(data, c.get("requestId")), 201);
});

export default stock;
