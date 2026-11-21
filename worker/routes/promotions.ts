/**
 * Rute promo (kontrak G1b modul Promo + aturan Fajar):
 * - GET    /api/v1/promotions — daftar promo outlet. Owner/manager melihat
 *   semua; kasir/dapur hanya yang aktif & dalam masa berlaku (aturan 8/9).
 * - POST   /api/v1/promotions — owner/manager (aturan 9). Validasi config
 *   per tipe meniru persis syarat mesin harga (worker/lib/pricing.ts):
 *   percent {percent 1..100, product_id?}, nominal {amount>=1,
 *   min_subtotal?}, bogo {product_id, buy_qty>=1, free_qty>=1},
 *   bundle {items[{product_id, qty>=1}] non-kosong, bundle_price>=0},
 *   free_item {free_product_id, qty?, min_subtotal?}. Produk yang dirujuk
 *   config wajib ada di outlet ini.
 * - PATCH  /api/v1/promotions/:id — owner/manager; termasuk menonaktifkan
 *   lewat is_active.
 * - DELETE /api/v1/promotions/:id — owner/manager; soft delete.
 *
 * Kolom code (migrasi 0009) memungkinkan kasir memakai promo lewat kode pada
 * POST /orders (promotion_codes); kode unik per outlet bila terisi —
 * duplikat -> CONFLICT. Penerapan promo tetap dihitung server di orders
 * (aturan 1); endpoint ini hanya mengelola definisi promo.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { requireRole } from "../lib/auth";
import { parsePagination, parseWith, readJsonBody } from "../lib/validate";
import type { Env, Variables } from "../lib/types";

const promotions = new Hono<{ Bindings: Env; Variables: Variables }>();

interface PromotionRow {
  id: string; outlet_id: string; name: string; code: string | null;
  type: string; config: string | null; starts_at: number | null;
  ends_at: number | null; is_stackable: number; max_discount: number | null;
  is_active: number; created_at: number; updated_at: number; version: number;
}

function parseConfig(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const promotionOut = (r: PromotionRow) => ({
  id: r.id, outlet_id: r.outlet_id, name: r.name, code: r.code,
  type: r.type, config: parseConfig(r.config),
  starts_at: r.starts_at, ends_at: r.ends_at,
  is_stackable: r.is_stackable === 1, max_discount: r.max_discount,
  is_active: r.is_active === 1,
  created_at: r.created_at, updated_at: r.updated_at, version: r.version,
});

async function fetchPromotion(
  db: D1Database, outletId: string, id: string,
): Promise<PromotionRow> {
  const row = await db
    .prepare("SELECT * FROM promotions WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(id, outletId)
    .first<PromotionRow>();
  if (!row) throw new ApiError("NOT_FOUND", "Promo tidak ditemukan");
  return row;
}

async function assertCodeFree(
  db: D1Database, outletId: string, code: string, excludeId?: string,
): Promise<void> {
  const row = await db
    .prepare("SELECT id FROM promotions WHERE outlet_id = ? AND code = ? AND deleted_at IS NULL")
    .bind(outletId, code)
    .first<{ id: string }>();
  if (row && row.id !== excludeId) {
    throw new ApiError("CONFLICT", "Kode promo sudah dipakai promo lain di outlet ini", {
      code,
    });
  }
}

async function assertProductExists(
  db: D1Database, outletId: string, productId: unknown, field: string,
): Promise<void> {
  if (typeof productId !== "string" || productId.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
      [field]: "Wajib berupa id produk",
    });
  }
  const row = await db
    .prepare("SELECT id FROM products WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(productId, outletId)
    .first<{ id: string }>();
  if (!row) {
    throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
      [field]: `Produk ${productId} tidak ditemukan di outlet ini`,
    });
  }
}

function cfgIntField(
  cfg: Record<string, unknown>,
  key: string,
  field: string,
  opts: { required?: boolean; min?: number; max?: number },
): void {
  const raw = cfg[key];
  if (raw === undefined || raw === null) {
    if (opts.required) {
      throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
        [field]: `config.${key} wajib diisi`,
      });
    }
    return;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
      [field]: `config.${key} harus bilangan bulat`,
    });
  }
  if (opts.min !== undefined && raw < opts.min) {
    throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
      [field]: `config.${key} minimal ${opts.min}`,
    });
  }
  if (opts.max !== undefined && raw > opts.max) {
    throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
      [field]: `config.${key} maksimal ${opts.max}`,
    });
  }
}

/** Validasi config per tipe — cermin syarat worker/lib/pricing.ts. */
async function validatePromoConfig(
  db: D1Database,
  outletId: string,
  type: string,
  cfg: Record<string, unknown>,
): Promise<void> {
  if (type === "percent") {
    cfgIntField(cfg, "percent", "config.percent", { required: true, min: 1, max: 100 });
    if (cfg["product_id"] !== undefined && cfg["product_id"] !== null) {
      await assertProductExists(db, outletId, cfg["product_id"], "config.product_id");
    }
  } else if (type === "nominal") {
    cfgIntField(cfg, "amount", "config.amount", { required: true, min: 1 });
    cfgIntField(cfg, "min_subtotal", "config.min_subtotal", { min: 0 });
  } else if (type === "bogo") {
    await assertProductExists(db, outletId, cfg["product_id"], "config.product_id");
    cfgIntField(cfg, "buy_qty", "config.buy_qty", { required: true, min: 1 });
    cfgIntField(cfg, "free_qty", "config.free_qty", { required: true, min: 1 });
  } else if (type === "bundle") {
    const items = cfg["items"];
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
        "config.items": "Wajib berisi minimal 1 item paket",
      });
    }
    for (const [i, raw] of items.entries()) {
      if (typeof raw !== "object" || raw === null) {
        throw new ApiError("VALIDATION_ERROR", "Config promo tidak valid", {
          [`config.items.${i}`]: "Item paket harus objek {product_id, qty}",
        });
      }
      const item = raw as Record<string, unknown>;
      await assertProductExists(db, outletId, item["product_id"], `config.items.${i}.product_id`);
      cfgIntField(item, "qty", `config.items.${i}.qty`, { required: true, min: 1 });
    }
    cfgIntField(cfg, "bundle_price", "config.bundle_price", { required: true, min: 0 });
  } else if (type === "free_item") {
    await assertProductExists(db, outletId, cfg["free_product_id"], "config.free_product_id");
    cfgIntField(cfg, "qty", "config.qty", { min: 1 });
    cfgIntField(cfg, "min_subtotal", "config.min_subtotal", { min: 0 });
  }
}

const promoTypeEnum = z.enum(["percent", "nominal", "bogo", "bundle", "free_item"]);

const createPromotionSchema = z.object({
  name: z.string().min(1, "Nama promo wajib diisi"),
  code: z.string().min(1).nullable().optional(),
  type: promoTypeEnum,
  config: z.record(z.unknown()).default({}),
  starts_at: z.number().int().nullable().optional(),
  ends_at: z.number().int().nullable().optional(),
  is_stackable: z.boolean().default(false),
  max_discount: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().default(true),
});

const patchPromotionSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).nullable().optional(),
  type: promoTypeEnum.optional(),
  config: z.record(z.unknown()).optional(),
  starts_at: z.number().int().nullable().optional(),
  ends_at: z.number().int().nullable().optional(),
  is_stackable: z.boolean().optional(),
  max_discount: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
});

function assertWindowValid(
  startsAt: number | null, endsAt: number | null,
): void {
  if (startsAt != null && endsAt != null && endsAt <= startsAt) {
    throw new ApiError("VALIDATION_ERROR", "Masa berlaku promo tidak valid", {
      ends_at: "ends_at harus setelah starts_at",
    });
  }
}

promotions.get("/promotions", async (c) => {
  const user = c.get("user");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const db = c.env.DB;
  const privileged = user.role === "owner" || user.role === "manager";
  const now = Date.now();
  const conds: string[] = ["outlet_id = ?", "deleted_at IS NULL"];
  const binds: unknown[] = [user.outlet_id];
  if (!privileged) {
    conds.push("is_active = 1");
    conds.push("(starts_at IS NULL OR starts_at <= ?)");
    binds.push(now);
    conds.push("(ends_at IS NULL OR ends_at >= ?)");
    binds.push(now);
  } else if (c.req.query("is_active") === "1") {
    conds.push("is_active = 1");
  } else if (c.req.query("is_active") === "0") {
    conds.push("is_active = 0");
  }
  const whereSql = conds.join(" AND ");
  const total = await db
    .prepare(`SELECT COUNT(*) AS n FROM promotions WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await db
    .prepare(`SELECT * FROM promotions WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<PromotionRow>();
  return c.json(
    successEnvelope(results.map(promotionOut), c.get("requestId"), {
      page, per_page: perPage, total: total?.n ?? 0,
    }),
    200,
  );
});

promotions.post("/promotions", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const body = parseWith(createPromotionSchema, await readJsonBody(c.req));
  const startsAt = body.starts_at ?? null;
  const endsAt = body.ends_at ?? null;
  assertWindowValid(startsAt, endsAt);
  await validatePromoConfig(db, user.outlet_id, body.type, body.config);
  const code = body.code?.trim() ? body.code.trim() : null;
  if (code) await assertCodeFree(db, user.outlet_id, code);

  const t = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO promotions (id, outlet_id, name, code, type, config, starts_at,
              ends_at, is_stackable, max_discount, is_active, created_at,
              updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
    )
    .bind(
      id, user.outlet_id, body.name, code, body.type,
      JSON.stringify(body.config), startsAt, endsAt,
      body.is_stackable ? 1 : 0, body.max_discount ?? null,
      body.is_active ? 1 : 0, t, t,
    )
    .run();
  const row = await fetchPromotion(db, user.outlet_id, id);
  return c.json(successEnvelope(promotionOut(row), c.get("requestId")), 201);
});

promotions.patch("/promotions/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const body = parseWith(patchPromotionSchema, await readJsonBody(c.req));
  const current = await fetchPromotion(db, user.outlet_id, c.req.param("id"));

  const nextType = body.type ?? current.type;
  const nextConfig = body.config ?? parseConfig(current.config);
  const nextStarts = body.starts_at !== undefined ? body.starts_at : current.starts_at;
  const nextEnds = body.ends_at !== undefined ? body.ends_at : current.ends_at;
  assertWindowValid(nextStarts, nextEnds);
  if (body.type !== undefined || body.config !== undefined) {
    await validatePromoConfig(db, user.outlet_id, nextType, nextConfig);
  }
  const nextCode =
    body.code !== undefined ? (body.code?.trim() ? body.code.trim() : null) : current.code;
  if (nextCode && nextCode !== current.code) {
    await assertCodeFree(db, user.outlet_id, nextCode, current.id);
  }

  const t = Date.now();
  await db
    .prepare(
      `UPDATE promotions SET name = ?, code = ?, type = ?, config = ?,
              starts_at = ?, ends_at = ?, is_stackable = ?, max_discount = ?,
              is_active = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    )
    .bind(
      body.name ?? current.name,
      nextCode,
      nextType,
      JSON.stringify(nextConfig),
      nextStarts,
      nextEnds,
      body.is_stackable !== undefined
        ? body.is_stackable ? 1 : 0
        : current.is_stackable,
      body.max_discount !== undefined ? body.max_discount : current.max_discount,
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : current.is_active,
      t,
      current.id,
    )
    .run();
  const updated = await fetchPromotion(db, user.outlet_id, current.id);
  return c.json(successEnvelope(promotionOut(updated), c.get("requestId")), 200);
});

promotions.delete("/promotions/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const current = await fetchPromotion(db, user.outlet_id, c.req.param("id"));
  const t = Date.now();
  await db
    .prepare("UPDATE promotions SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(t, t, current.id)
    .run();
  return c.json(
    successEnvelope({ id: current.id, deleted: true }, c.get("requestId")),
    200,
  );
});

export default promotions;
