/**
 * Rute order (kontrak G1b + aturan promo Fajar):
 * - POST /api/v1/orders — Idempotency-Key wajib; harga SELALU dihitung ulang
 *   server dari produk/varian/opsi aktif (harga dari klien diabaikan); wajib
 *   shift terbuka milik kasir (SHIFT_NOT_OPEN); stok bahan diperiksa
 *   (INSUFFICIENT_STOCK) dan dikurangi HANYA lewat stock_movements type 'sale'.
 * - GET  /api/v1/orders — filter status, payment_status, kitchen_status,
 *   shift_id, date_from, date_to (epoch ms).
 * - GET  /api/v1/orders/:id — detail + item + pembayaran.
 * - POST /api/v1/orders/:id/cancel — hanya bila kitchen_status masih 'queued'
 *   dan belum ada pembayaran settled; stok dikembalikan lewat stock_movements
 *   type 'return' (skema G1a tidak punya type 'void'; alasan tercatat di note
 *   dan audit_logs), pembayaran pending ikut di-void. Selain itu CONFLICT.
 *
 * client_tx_id duplikat per outlet -> CONFLICT (G1b bagian 3), sedangkan
 * replay Idempotency-Key dengan isi sama mengembalikan respons asli (G1b
 * bagian 4) tanpa order/stok ganda.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { parsePagination, parseWith, readJsonBody } from "../lib/validate";
import {
  findStoredResponse,
  hashRequestBody,
  requireIdempotencyKey,
  storeResponse,
} from "../lib/idempotency";
import {
  priceOrder,
  type PricingLineInput,
  type PromotionInput,
  type PromotionType,
} from "../lib/pricing";
import { findOpenShift } from "./shifts";
import type { AuthUser, Env, Variables } from "../lib/types";

const orders = new Hono<{ Bindings: Env; Variables: Variables }>();

// ------------------------------------------------------------------ schemas

const itemModifierInput = z.object({
  modifier_option_id: z.string().min(1),
  qty: z.number().int().min(1).default(1),
});
const itemInput = z.object({
  product_id: z.string().min(1),
  variant_id: z.string().min(1).nullable().optional(),
  qty: z.number().int().min(1, "Qty minimal 1"),
  note: z.string().nullable().optional(),
  modifiers: z.array(itemModifierInput).default([]),
});
const createOrderSchema = z.object({
  type: z.enum(["dine_in", "takeaway", "online"]).default("dine_in"),
  table_id: z.string().min(1).nullable().optional(),
  note: z.string().nullable().optional(),
  client_tx_id: z.string().min(1).nullable().optional(),
  promotion_ids: z.array(z.string().min(1)).default([]),
  promotion_codes: z.array(z.string().min(1)).default([]),
  items: z.array(itemInput).min(1, "Order harus berisi minimal 1 item"),
});

// ------------------------------------------------------------------ row types

interface ProductRow {
  id: string; name: string; base_price: number; is_active: number;
  is_stock_tracked: number;
}
interface OptionRow {
  id: string; modifier_id: string; name: string; price_delta: number;
  stock_product_id: string | null;
  modifier_name: string; selection_type: string; is_required: number;
  min_select: number; max_select: number | null; attached: string | null;
}
interface OrderRow {
  id: string; outlet_id: string; table_id: string | null; order_no: string;
  type: string; status: string; payment_status: string; kitchen_status: string;
  cashier_id: string | null; shift_id: string | null;
  subtotal: number; discount_total: number; tax_total: number; grand_total: number;
  client_tx_id: string | null; note: string | null;
  created_at: number; updated_at: number; version: number;
}

export const orderOut = (r: OrderRow) => ({
  id: r.id, outlet_id: r.outlet_id, table_id: r.table_id, order_no: r.order_no,
  type: r.type, status: r.status, payment_status: r.payment_status,
  kitchen_status: r.kitchen_status, cashier_id: r.cashier_id,
  shift_id: r.shift_id, subtotal: r.subtotal, discount_total: r.discount_total,
  tax_total: r.tax_total, grand_total: r.grand_total,
  client_tx_id: r.client_tx_id, note: r.note,
  created_at: r.created_at, updated_at: r.updated_at, version: r.version,
});

export async function fetchOrder(
  db: D1Database, outletId: string, id: string,
): Promise<OrderRow> {
  const row = await db
    .prepare("SELECT * FROM orders WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(id, outletId)
    .first<OrderRow>();
  if (!row) throw new ApiError("NOT_FOUND", "Order tidak ditemukan");
  return row;
}

/** Jumlah yang sudah terbayar lunas (payment_allocations dari pembayaran settled). */
export async function settledPaidTotal(
  db: D1Database, outletId: string, orderId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(pa.amount), 0) AS total
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
        WHERE pa.outlet_id = ? AND pa.order_id = ? AND p.status = 'settled'
          AND p.deleted_at IS NULL AND pa.deleted_at IS NULL`,
    )
    .bind(outletId, orderId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Turunkan payment_status dari total settled vs grand_total dan simpan. */
export async function refreshPaymentStatus(
  db: D1Database, outletId: string, order: OrderRow,
): Promise<OrderRow> {
  const paid = await settledPaidTotal(db, outletId, order.id);
  const status =
    order.grand_total > 0 && paid >= order.grand_total
      ? "paid"
      : paid > 0
        ? "partial"
        : "unpaid";
  let orderStatus = order.status;
  if (status === "paid" && orderStatus === "open") orderStatus = "paid";
  if (status !== order.payment_status || orderStatus !== order.status) {
    await db
      .prepare("UPDATE orders SET payment_status = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .bind(status, orderStatus, Date.now(), order.id)
      .run();
    return { ...order, payment_status: status, status: orderStatus };
  }
  return order;
}

// ------------------------------------------------------------- create order

interface ResolvedLine {
  pricing: PricingLineInput;
  product: ProductRow;
  variant_id: string | null;
  note: string | null;
}

async function resolveLines(
  db: D1Database,
  outletId: string,
  items: z.infer<typeof itemInput>[],
): Promise<{ lines: ResolvedLine[]; stockNeeds: Map<string, number> }> {
  const lines: ResolvedLine[] = [];
  const stockNeeds = new Map<string, number>();
  const addNeed = (productId: string, qty: number) =>
    stockNeeds.set(productId, (stockNeeds.get(productId) ?? 0) + qty);

  for (const [idx, item] of items.entries()) {
    const field = `items.${idx}`;
    const product = await db
      .prepare("SELECT id, name, base_price, is_active, is_stock_tracked FROM products WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
      .bind(item.product_id, outletId)
      .first<ProductRow>();
    if (!product) {
      throw new ApiError("VALIDATION_ERROR", "Produk pada item tidak ditemukan", {
        [`${field}.product_id`]: "Produk tidak ditemukan di outlet ini",
      });
    }
    if (product.is_active !== 1) {
      throw new ApiError("VALIDATION_ERROR", "Produk tidak aktif", {
        [`${field}.product_id`]: `Produk "${product.name}" sedang nonaktif`,
      });
    }

    let variantDelta = 0;
    if (item.variant_id) {
      const variant = await db
        .prepare("SELECT price_delta FROM product_variants WHERE id = ? AND product_id = ? AND outlet_id = ? AND deleted_at IS NULL")
        .bind(item.variant_id, product.id, outletId)
        .first<{ price_delta: number }>();
      if (!variant) {
        throw new ApiError("VALIDATION_ERROR", "Varian tidak ditemukan untuk produk ini", {
          [`${field}.variant_id`]: "Varian tidak valid",
        });
      }
      variantDelta = variant.price_delta;
    }

    // Gabungkan opsi yang sama, lalu validasi terhadap grup opsi produk.
    const merged = new Map<string, number>();
    for (const m of item.modifiers) {
      merged.set(m.modifier_option_id, (merged.get(m.modifier_option_id) ?? 0) + m.qty);
    }
    const chosen: OptionRow[] = [];
    for (const [optionId, qty] of merged) {
      const opt = await db
        .prepare(
          `SELECT mo.id, mo.modifier_id, mo.name, mo.price_delta, mo.stock_product_id,
                  m.name AS modifier_name, m.selection_type, m.is_required, m.min_select, m.max_select,
                  pm.id AS attached
             FROM modifier_options mo
             JOIN modifiers m ON m.id = mo.modifier_id
             LEFT JOIN product_modifiers pm
               ON pm.modifier_id = mo.modifier_id AND pm.product_id = ? AND pm.deleted_at IS NULL
            WHERE mo.id = ? AND mo.outlet_id = ? AND mo.deleted_at IS NULL AND m.deleted_at IS NULL`,
        )
        .bind(product.id, optionId, outletId)
        .first<OptionRow>();
      if (!opt || !opt.attached) {
        throw new ApiError("VALIDATION_ERROR", "Opsi tidak terpasang pada produk ini", {
          [`${field}.modifiers`]: `Opsi ${optionId} tidak valid untuk produk "${product.name}"`,
        });
      }
      chosen.push(opt);
      if (opt.stock_product_id) {
        addNeed(opt.stock_product_id, qty * item.qty);
      }
    }

    // Aturan grup opsi: wajib / min / max / single.
    const { results: attachedGroups } = await db
      .prepare(
        `SELECT m.id, m.name, m.selection_type, m.is_required, m.min_select, m.max_select
           FROM product_modifiers pm JOIN modifiers m ON m.id = pm.modifier_id
          WHERE pm.product_id = ? AND pm.outlet_id = ? AND pm.deleted_at IS NULL AND m.deleted_at IS NULL`,
      )
      .bind(product.id, outletId)
      .all<{ id: string; name: string; selection_type: string; is_required: number; min_select: number; max_select: number | null }>();
    for (const g of attachedGroups) {
      const count = chosen.filter((o) => o.modifier_id === g.id).length;
      if (g.is_required === 1 && count === 0) {
        throw new ApiError("VALIDATION_ERROR", `Grup opsi "${g.name}" wajib dipilih`, {
          [`${field}.modifiers`]: `Grup "${g.name}" wajib dipilih untuk "${product.name}"`,
        });
      }
      if (count < g.min_select) {
        throw new ApiError("VALIDATION_ERROR", `Grup opsi "${g.name}" minimal ${g.min_select} pilihan`, {
          [`${field}.modifiers`]: `Minimal ${g.min_select} pilihan pada grup "${g.name}"`,
        });
      }
      if (g.selection_type === "single" && count > 1) {
        throw new ApiError("VALIDATION_ERROR", `Grup opsi "${g.name}" hanya boleh satu pilihan`, {
          [`${field}.modifiers`]: `Grup "${g.name}" bersifat pilihan tunggal`,
        });
      }
      if (g.max_select != null && count > g.max_select) {
        throw new ApiError("VALIDATION_ERROR", `Grup opsi "${g.name}" maksimal ${g.max_select} pilihan`, {
          [`${field}.modifiers`]: `Maksimal ${g.max_select} pilihan pada grup "${g.name}"`,
        });
      }
    }

    if (product.is_stock_tracked === 1) addNeed(product.id, item.qty);

    lines.push({
      product,
      variant_id: item.variant_id ?? null,
      note: item.note ?? null,
      pricing: {
        product_id: product.id,
        name: product.name,
        qty: item.qty,
        unit_base: product.base_price + variantDelta,
        modifiers: chosen.map((o) => ({
          modifier_option_id: o.id,
          name: o.name,
          price_delta: o.price_delta,
          qty: merged.get(o.id) ?? 1,
        })),
      },
    });
  }
  return { lines, stockNeeds };
}

async function resolvePromotions(
  db: D1Database,
  outletId: string,
  ids: string[],
): Promise<PromotionInput[]> {
  const promos: PromotionInput[] = [];
  for (const id of ids) {
    const row = await db
      .prepare("SELECT * FROM promotions WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
      .bind(id, outletId)
      .first<{
        id: string; name: string; type: PromotionType; config: string | null;
        starts_at: number | null; ends_at: number | null; is_stackable: number;
        max_discount: number | null; is_active: number;
      }>();
    if (!row) {
      throw new ApiError("VALIDATION_ERROR", "Promo tidak ditemukan", {
        promotion_ids: `Promo ${id} tidak ditemukan di outlet ini`,
      });
    }
    let config: Record<string, unknown> = {};
    if (row.config) {
      try {
        config = JSON.parse(row.config) as Record<string, unknown>;
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Config promo rusak", {
          promotion_ids: `Config promo "${row.name}" bukan JSON yang sah`,
        });
      }
    }
    promos.push({
      id: row.id, name: row.name, type: row.type, config,
      is_stackable: row.is_stackable === 1, max_discount: row.max_discount,
      is_active: row.is_active === 1, starts_at: row.starts_at, ends_at: row.ends_at,
    });
  }
  return promos;
}

/** Terjemahkan kode promo (kolom promotions.code, migrasi 0009) menjadi id. */
async function resolvePromotionCodes(
  db: D1Database,
  outletId: string,
  codes: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const code of codes) {
    const row = await db
      .prepare("SELECT id FROM promotions WHERE outlet_id = ? AND code = ? AND deleted_at IS NULL")
      .bind(outletId, code)
      .first<{ id: string }>();
    if (!row) {
      throw new ApiError("VALIDATION_ERROR", "Kode promo tidak dikenal", {
        promotion_codes: `Kode promo "${code}" tidak ditemukan di outlet ini`,
      });
    }
    ids.push(row.id);
  }
  return ids;
}

async function stockBalance(
  db: D1Database, outletId: string, productId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(qty_delta), 0) AS bal FROM stock_movements WHERE outlet_id = ? AND product_id = ?")
    .bind(outletId, productId)
    .first<{ bal: number }>();
  return row?.bal ?? 0;
}

async function orderDetail(
  db: D1Database, outletId: string, order: OrderRow,
) {
  const { results: items } = await db
    .prepare(
      `SELECT oi.*, p.name AS product_name
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ? AND oi.outlet_id = ? AND oi.deleted_at IS NULL
        ORDER BY oi.created_at ASC`,
    )
    .bind(order.id, outletId)
    .all<{
      id: string; product_id: string | null; product_name: string | null;
      variant_id: string | null; qty: number; unit_price: number;
      line_discount: number; line_total: number; note: string | null;
    }>();
  const outItems = [];
  for (const it of items) {
    const { results: mods } = await db
      .prepare("SELECT modifier_option_id, name_snapshot, price_delta, qty FROM order_item_modifiers WHERE order_item_id = ? AND outlet_id = ? AND deleted_at IS NULL")
      .bind(it.id, outletId)
      .all<{ modifier_option_id: string | null; name_snapshot: string | null; price_delta: number; qty: number }>();
    outItems.push({
      id: it.id, product_id: it.product_id, product_name: it.product_name,
      variant_id: it.variant_id, qty: it.qty, unit_price: it.unit_price,
      line_discount: it.line_discount, line_total: it.line_total, note: it.note,
      modifiers: mods.map((m) => ({
        modifier_option_id: m.modifier_option_id, name: m.name_snapshot,
        price_delta: m.price_delta, qty: m.qty,
      })),
    });
  }
  const { results: usages } = await db
    .prepare("SELECT promotion_id, discount_amount FROM promotion_usages WHERE order_id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(order.id, outletId)
    .all<{ promotion_id: string; discount_amount: number }>();
  const { results: payments } = await db
    .prepare("SELECT id, method, amount, change_amount, status, reference_no, created_at FROM payments WHERE order_id = ? AND outlet_id = ? AND deleted_at IS NULL ORDER BY created_at ASC")
    .bind(order.id, outletId)
    .all<{ id: string; method: string; amount: number; change_amount: number; status: string; reference_no: string | null; created_at: number }>();
  return {
    ...orderOut(order),
    items: outItems,
    promotions: usages,
    payments,
    paid_total: await settledPaidTotal(db, outletId, order.id),
  };
}

/**
 * Inti pembuatan order — dipakai rute POST /orders DAN sinkronisasi offline
 * (worker/routes/sync.ts) agar aturan harga server, stok, dan shift persis
 * sama di kedua jalur. idemKey null berarti tanpa lapisan Idempotency-Key
 * (jalur sync memakai client_tx_id + sync_events sebagai idempotensinya).
 */
export async function createOrderCore(
  db: D1Database,
  user: AuthUser,
  rawBody: unknown,
  idemKey: string | null,
): Promise<{ status: number; data: unknown }> {
  const body = parseWith(createOrderSchema, rawBody);

  // Idempotensi (G1b bagian 4) — hanya jalur online berkunci header.
  let requestHash = "";
  if (idemKey) {
    requestHash = await hashRequestBody(rawBody);
    const stored = await findStoredResponse(db, user.outlet_id, idemKey, requestHash);
    if (stored) {
      return { status: stored.status_code, data: JSON.parse(stored.response_json) };
    }
  }

  // client_tx_id duplikat -> CONFLICT (G1b bagian 3).
  if (body.client_tx_id) {
    const dup = await db
      .prepare("SELECT id FROM orders WHERE outlet_id = ? AND client_tx_id = ?")
      .bind(user.outlet_id, body.client_tx_id)
      .first<{ id: string }>();
    if (dup) {
      throw new ApiError("CONFLICT", "client_tx_id sudah dipakai order lain", {
        client_tx_id: body.client_tx_id,
      });
    }
  }

  // Wajib shift terbuka milik kasir yang login.
  const shift = await findOpenShift(db, user.outlet_id, user.id);
  if (!shift) {
    throw new ApiError("SHIFT_NOT_OPEN", "Kasir belum membuka shift");
  }

  if (body.table_id) {
    const tbl = await db
      .prepare("SELECT id FROM tables WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
      .bind(body.table_id, user.outlet_id)
      .first<{ id: string }>();
    if (!tbl) {
      throw new ApiError("VALIDATION_ERROR", "Meja tidak ditemukan", {
        table_id: "Meja tidak ditemukan di outlet ini",
      });
    }
  }

  const { lines, stockNeeds } = await resolveLines(db, user.outlet_id, body.items);
  const codeIds = await resolvePromotionCodes(db, user.outlet_id, body.promotion_codes);
  const allPromotionIds = [...new Set([...body.promotion_ids, ...codeIds])];
  const promotions = await resolvePromotions(db, user.outlet_id, allPromotionIds);

  const outlet = await db
    .prepare("SELECT tax_rate_bp FROM outlets WHERE id = ?")
    .bind(user.outlet_id)
    .first<{ tax_rate_bp: number }>();
  const priced = priceOrder({
    lines: lines.map((l) => l.pricing),
    promotions,
    tax_rate_bp: outlet?.tax_rate_bp ?? 0,
    now: Date.now(),
  });

  // Periksa stok bahan sebelum menulis apa pun.
  for (const [productId, need] of stockNeeds) {
    const balance = await stockBalance(db, user.outlet_id, productId);
    if (balance < need) {
      const p = await db
        .prepare("SELECT name FROM products WHERE id = ?")
        .bind(productId)
        .first<{ name: string }>();
      throw new ApiError("INSUFFICIENT_STOCK", "Stok bahan tidak cukup", {
        product_id: productId,
        product_name: p?.name ?? productId,
        needed: need,
        available: balance,
      });
    }
  }

  // Tulis order + item + usage + gerakan stok dalam satu batch.
  const t = Date.now();
  const orderId = crypto.randomUUID();
  const day = new Date(t);
  const ymd = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const countRow = await db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE outlet_id = ? AND created_at >= ?")
    .bind(user.outlet_id, dayStart)
    .first<{ n: number }>();
  const orderNo = `SBL-${ymd}-${String((countRow?.n ?? 0) + 1).padStart(4, "0")}`;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(
        `INSERT INTO orders (id, outlet_id, table_id, order_no, type, status, payment_status, kitchen_status,
                cashier_id, shift_id, subtotal, discount_total, tax_total, grand_total,
                client_tx_id, note, created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, 'open', 'unpaid', 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
      )
      .bind(
        orderId, user.outlet_id, body.table_id ?? null, orderNo, body.type,
        user.id, shift.id, priced.subtotal, priced.discount_total,
        priced.tax_total, priced.grand_total, body.client_tx_id ?? null,
        body.note ?? null, t, t,
      ),
  );

  const pricedByIndex = priced.lines;
  lines.forEach((line, i) => {
    const pl = pricedByIndex[i] as (typeof pricedByIndex)[number];
    const itemId = crypto.randomUUID();
    stmts.push(
      db
        .prepare(
          `INSERT INTO order_items (id, outlet_id, order_id, product_id, variant_id, qty, unit_price,
                  line_discount, line_total, note, created_at, updated_at, deleted_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        )
        .bind(
          itemId, user.outlet_id, orderId, line.product.id, line.variant_id,
          line.pricing.qty, pl.unit_price, pl.line_discount, pl.line_total,
          line.note, t, t,
        ),
    );
    for (const m of line.pricing.modifiers) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO order_item_modifiers (id, outlet_id, order_item_id, modifier_option_id,
                    name_snapshot, price_delta, qty, created_at, updated_at, deleted_at, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
          )
          .bind(
            crypto.randomUUID(), user.outlet_id, itemId, m.modifier_option_id,
            m.name, m.price_delta, m.qty, t, t,
          ),
      );
    }
  });

  for (const ap of priced.applied_promotions) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO promotion_usages (id, outlet_id, promotion_id, order_id, discount_amount,
                  applied_at, created_at, updated_at, deleted_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
        )
        .bind(crypto.randomUUID(), user.outlet_id, ap.promotion_id, orderId, ap.discount_amount, t, t, t),
    );
  }

  for (const [productId, qty] of stockNeeds) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements (id, outlet_id, product_id, batch_id, type, qty_delta,
                  ref_type, ref_id, note, created_by, created_at)
           VALUES (?, ?, ?, NULL, 'sale', ?, 'order', ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), user.outlet_id, productId, -qty, orderId, "Penjualan order", user.id, t),
    );
  }

  await db.batch(stmts);

  const order = await fetchOrder(db, user.outlet_id, orderId);
  const detail = await orderDetail(db, user.outlet_id, order);
  if (idemKey) {
    await storeResponse(db, user.outlet_id, idemKey, requestHash, 201, detail);
  }
  return { status: 201, data: detail };
}

orders.post("/orders", async (c) => {
  const user = c.get("user");
  const rawBody = await readJsonBody(c.req);
  const idemKey = requireIdempotencyKey(c.req.header("Idempotency-Key"));
  const result = await createOrderCore(c.env.DB, user, rawBody, idemKey);
  return c.json(
    successEnvelope(result.data, c.get("requestId")),
    result.status as 201,
  );
});

// ------------------------------------------------------------------- reads

orders.get("/orders", async (c) => {
  const user = c.get("user");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const conds: string[] = ["outlet_id = ?", "deleted_at IS NULL"];
  const binds: unknown[] = [user.outlet_id];
  const status = c.req.query("status");
  if (status) { conds.push("status = ?"); binds.push(status); }
  const payStatus = c.req.query("payment_status");
  if (payStatus) { conds.push("payment_status = ?"); binds.push(payStatus); }
  const kitchenStatus = c.req.query("kitchen_status");
  if (kitchenStatus) { conds.push("kitchen_status = ?"); binds.push(kitchenStatus); }
  const shiftId = c.req.query("shift_id");
  if (shiftId) { conds.push("shift_id = ?"); binds.push(shiftId); }
  const dateFrom = c.req.query("date_from");
  if (dateFrom && Number.isFinite(Number(dateFrom))) { conds.push("created_at >= ?"); binds.push(Number(dateFrom)); }
  const dateTo = c.req.query("date_to");
  if (dateTo && Number.isFinite(Number(dateTo))) { conds.push("created_at <= ?"); binds.push(Number(dateTo)); }
  const whereSql = conds.join(" AND ");
  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM orders WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<OrderRow>();
  return c.json(
    successEnvelope(results.map(orderOut), c.get("requestId"), {
      page, per_page: perPage, total: total?.n ?? 0,
    }),
    200,
  );
});

orders.get("/orders/:id", async (c) => {
  const user = c.get("user");
  const order = await fetchOrder(c.env.DB, user.outlet_id, c.req.param("id"));
  const detail = await orderDetail(c.env.DB, user.outlet_id, order);
  return c.json(successEnvelope(detail, c.get("requestId")), 200);
});

// ------------------------------------------------------------------ cancel

orders.post("/orders/:id/cancel", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const order = await fetchOrder(db, user.outlet_id, c.req.param("id"));
  if (order.status === "void") {
    throw new ApiError("CONFLICT", "Order sudah dibatalkan");
  }
  const settled = await settledPaidTotal(db, user.outlet_id, order.id);
  if (order.kitchen_status !== "queued" || settled > 0 || order.payment_status === "paid") {
    throw new ApiError(
      "CONFLICT",
      "Order hanya bisa dibatalkan saat masih antre di dapur dan belum ada pembayaran yang terkonfirmasi",
      { kitchen_status: order.kitchen_status, settled_total: settled },
    );
  }
  const t = Date.now();
  const stmts: D1PreparedStatement[] = [];
  // Kembalikan stok: balik setiap gerakan 'sale' order ini dengan type 'return'.
  const { results: sales } = await db
    .prepare("SELECT product_id, qty_delta FROM stock_movements WHERE outlet_id = ? AND ref_type = 'order' AND ref_id = ? AND type = 'sale'")
    .bind(user.outlet_id, order.id)
    .all<{ product_id: string; qty_delta: number }>();
  for (const s of sales) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO stock_movements (id, outlet_id, product_id, batch_id, type, qty_delta,
                  ref_type, ref_id, note, created_by, created_at)
           VALUES (?, ?, ?, NULL, 'return', ?, 'order', ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), user.outlet_id, s.product_id, -s.qty_delta, order.id, "Pembatalan order (void)", user.id, t),
    );
  }
  stmts.push(
    db
      .prepare("UPDATE payments SET status = 'void', updated_at = ?, version = version + 1 WHERE order_id = ? AND outlet_id = ? AND status = 'pending' AND deleted_at IS NULL")
      .bind(t, order.id, user.outlet_id),
  );
  stmts.push(
    db
      .prepare("UPDATE orders SET status = 'void', updated_at = ?, version = version + 1 WHERE id = ?")
      .bind(t, order.id),
  );
  stmts.push(
    db
      .prepare(
        "INSERT INTO audit_logs (id, outlet_id, user_id, action, entity, entity_id, before_json, after_json, created_at) VALUES (?, ?, ?, 'order.void', 'orders', ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(), user.outlet_id, user.id, order.id,
        JSON.stringify({ status: order.status, kitchen_status: order.kitchen_status }),
        JSON.stringify({ status: "void" }),
        t,
      ),
  );
  await db.batch(stmts);
  const updated = await fetchOrder(db, user.outlet_id, order.id);
  const detail = await orderDetail(db, user.outlet_id, updated);
  return c.json(successEnvelope(detail, c.get("requestId")), 200);
});

export default orders;
