/**
 * Rute master data / katalog (kontrak G1b):
 * - categories : GET, POST, PATCH /:id, DELETE /:id (soft delete)
 * - products   : GET (filter category_id, q, is_active), POST, GET /:id,
 *                PATCH /:id, DELETE /:id (soft delete)
 * - variants   : POST /products/:id/variants, PATCH /variants/:id,
 *                DELETE /variants/:id (soft delete)
 * - modifiers  : GET, POST, PATCH /:id (termasuk options di dalamnya),
 *                DELETE /:id (soft delete) — grup opsi seperti "Level Pedas"
 *                dan "Topping" beserta opsi berbayarnya.
 * - penghubung : POST /products/:id/modifiers, DELETE /products/:id/modifiers/:modifierId
 *
 * Bahan baku (ingredients) di skema G1a BUKAN tabel tersendiri: bahan adalah
 * products dengan is_stock_tracked = 1 yang dihubungkan ke opsi lewat
 * modifier_options.stock_product_id. CRUD-nya lewat endpoints products ini.
 *
 * Mutasi hanya owner/manager; baca boleh semua peran yang login.
 * Semua query ter-scope outlet_id dari sesi; hapus selalu soft delete.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { requireRole } from "../lib/auth";
import { parsePagination, parseWith, readJsonBody } from "../lib/validate";
import type { Env, Variables } from "../lib/types";

const master = new Hono<{ Bindings: Env; Variables: Variables }>();

const now = () => Date.now();

// ---------------------------------------------------------------- utilities

async function getOr404<T>(
  db: D1Database,
  sql: string,
  binds: unknown[],
  label: string,
): Promise<T> {
  const row = await db
    .prepare(sql)
    .bind(...binds)
    .first<T>();
  if (!row) throw new ApiError("NOT_FOUND", `${label} tidak ditemukan`);
  return row;
}

function bool(v: number): boolean {
  return v === 1;
}

// ---------------------------------------------------------------- categories

interface CategoryRow {
  id: string; outlet_id: string; name: string; sort_order: number;
  color: string | null; created_at: number; updated_at: number; version: number;
}

const categoryOut = (r: CategoryRow) => ({
  id: r.id, outlet_id: r.outlet_id, name: r.name, sort_order: r.sort_order,
  color: r.color, created_at: r.created_at, updated_at: r.updated_at,
  version: r.version,
});

const categoryCreate = z.object({
  name: z.string().min(1, "Nama kategori wajib diisi"),
  sort_order: z.number().int().default(0),
  color: z.string().nullable().optional(),
});
const categoryPatch = categoryCreate.partial();

master.get("/categories", async (c) => {
  const user = c.get("user");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const total = await c.env.DB
    .prepare("SELECT COUNT(*) AS n FROM categories WHERE outlet_id = ? AND deleted_at IS NULL")
    .bind(user.outlet_id)
    .first<{ n: number }>();
  const { results } = await c.env.DB
    .prepare(
      "SELECT * FROM categories WHERE outlet_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC LIMIT ? OFFSET ?",
    )
    .bind(user.outlet_id, limit, offset)
    .all<CategoryRow>();
  return c.json(
    successEnvelope(results.map(categoryOut), c.get("requestId"), {
      page, per_page: perPage, total: total?.n ?? 0,
    }),
    200,
  );
});

master.post("/categories", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const body = parseWith(categoryCreate, await readJsonBody(c.req));
  const t = now();
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      "INSERT INTO categories (id, outlet_id, name, sort_order, color, created_at, updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)",
    )
    .bind(id, user.outlet_id, body.name, body.sort_order, body.color ?? null, t, t)
    .run();
  const row = await getOr404<CategoryRow>(
    c.env.DB, "SELECT * FROM categories WHERE id = ?", [id], "Kategori",
  );
  return c.json(successEnvelope(categoryOut(row), c.get("requestId")), 201);
});

master.patch("/categories/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  const body = parseWith(categoryPatch, await readJsonBody(c.req));
  const row = await getOr404<CategoryRow>(
    c.env.DB,
    "SELECT * FROM categories WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, user.outlet_id],
    "Kategori",
  );
  await c.env.DB
    .prepare(
      "UPDATE categories SET name = ?, sort_order = ?, color = ?, updated_at = ?, version = version + 1 WHERE id = ?",
    )
    .bind(
      body.name ?? row.name,
      body.sort_order ?? row.sort_order,
      body.color !== undefined ? body.color : row.color,
      now(),
      id,
    )
    .run();
  const updated = await getOr404<CategoryRow>(
    c.env.DB, "SELECT * FROM categories WHERE id = ?", [id], "Kategori",
  );
  return c.json(successEnvelope(categoryOut(updated), c.get("requestId")), 200);
});

master.delete("/categories/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  await getOr404<CategoryRow>(
    c.env.DB,
    "SELECT * FROM categories WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, user.outlet_id],
    "Kategori",
  );
  await c.env.DB
    .prepare("UPDATE categories SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(now(), now(), id)
    .run();
  return c.json(successEnvelope({ id, deleted: true }, c.get("requestId")), 200);
});

// ---------------------------------------------------------------- products

interface ProductRow {
  id: string; outlet_id: string; category_id: string | null; name: string;
  sku: string | null; base_price: number; cost_price: number;
  is_stock_tracked: number; image_key: string | null; is_active: number;
  created_at: number; updated_at: number; version: number;
}

const productOut = (r: ProductRow) => ({
  id: r.id, outlet_id: r.outlet_id, category_id: r.category_id, name: r.name,
  sku: r.sku, base_price: r.base_price, cost_price: r.cost_price,
  is_stock_tracked: bool(r.is_stock_tracked), image_key: r.image_key,
  is_active: bool(r.is_active), created_at: r.created_at,
  updated_at: r.updated_at, version: r.version,
});

const productCreate = z.object({
  name: z.string().min(1, "Nama produk wajib diisi"),
  category_id: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  base_price: z.number().int().min(0, "Harga harus bilangan bulat >= 0"),
  cost_price: z.number().int().min(0).default(0),
  is_stock_tracked: z.boolean().default(false),
  image_key: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});
const productPatch = productCreate.partial();

async function fetchProduct(
  db: D1Database, outletId: string, id: string,
): Promise<ProductRow> {
  return getOr404<ProductRow>(
    db,
    "SELECT * FROM products WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, outletId],
    "Produk",
  );
}

master.get("/products", async (c) => {
  const user = c.get("user");
  const { page, perPage, limit, offset } = parsePagination(c.req.query());
  const conds: string[] = ["outlet_id = ?", "deleted_at IS NULL"];
  const binds: unknown[] = [user.outlet_id];
  const categoryId = c.req.query("category_id");
  if (categoryId) { conds.push("category_id = ?"); binds.push(categoryId); }
  const q = c.req.query("q");
  if (q) { conds.push("name LIKE ?"); binds.push(`%${q}%`); }
  const isActive = c.req.query("is_active");
  if (isActive === "true") conds.push("is_active = 1");
  if (isActive === "false") conds.push("is_active = 0");
  const whereSql = conds.join(" AND ");
  const total = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM products WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ n: number }>();
  const { results } = await c.env.DB
    .prepare(`SELECT * FROM products WHERE ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<ProductRow>();
  return c.json(
    successEnvelope(results.map(productOut), c.get("requestId"), {
      page, per_page: perPage, total: total?.n ?? 0,
    }),
    200,
  );
});

master.post("/products", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const body = parseWith(productCreate, await readJsonBody(c.req));
  if (body.category_id) {
    await getOr404(
      c.env.DB,
      "SELECT id FROM categories WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
      [body.category_id, user.outlet_id],
      "Kategori",
    );
  }
  const t = now();
  const id = crypto.randomUUID();
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO products (id, outlet_id, category_id, name, sku, base_price, cost_price, is_stock_tracked, image_key, is_active, created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
      )
      .bind(
        id, user.outlet_id, body.category_id ?? null, body.name, body.sku ?? null,
        body.base_price, body.cost_price, body.is_stock_tracked ? 1 : 0,
        body.image_key ?? null, body.is_active ? 1 : 0, t, t,
      )
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      throw new ApiError("CONFLICT", "SKU sudah dipakai produk lain di outlet ini", {
        sku: body.sku,
      });
    }
    throw e;
  }
  const row = await fetchProduct(c.env.DB, user.outlet_id, id);
  return c.json(successEnvelope(productOut(row), c.get("requestId")), 201);
});

interface VariantRow {
  id: string; product_id: string; name: string; price_delta: number;
  sku_suffix: string | null; version: number;
}
interface ModifierOptionRow {
  id: string; modifier_id: string; name: string; price_delta: number;
  stock_product_id: string | null;
}
interface ModifierRow {
  id: string; name: string; selection_type: string; is_required: number;
  min_select: number; max_select: number | null; version: number;
}

master.get("/products/:id", async (c) => {
  const user = c.get("user");
  const product = await fetchProduct(c.env.DB, user.outlet_id, c.req.param("id"));
  const { results: variants } = await c.env.DB
    .prepare("SELECT * FROM product_variants WHERE product_id = ? AND outlet_id = ? AND deleted_at IS NULL ORDER BY name ASC")
    .bind(product.id, user.outlet_id)
    .all<VariantRow>();
  const { results: links } = await c.env.DB
    .prepare(
      `SELECT m.* FROM product_modifiers pm
         JOIN modifiers m ON m.id = pm.modifier_id
        WHERE pm.product_id = ? AND pm.outlet_id = ? AND pm.deleted_at IS NULL AND m.deleted_at IS NULL
        ORDER BY pm.sort_order ASC`,
    )
    .bind(product.id, user.outlet_id)
    .all<ModifierRow>();
  const modifiers = [];
  for (const m of links) {
    const { results: options } = await c.env.DB
      .prepare("SELECT * FROM modifier_options WHERE modifier_id = ? AND outlet_id = ? AND deleted_at IS NULL ORDER BY name ASC")
      .bind(m.id, user.outlet_id)
      .all<ModifierOptionRow>();
    modifiers.push({
      id: m.id, name: m.name, selection_type: m.selection_type,
      is_required: bool(m.is_required), min_select: m.min_select,
      max_select: m.max_select,
      options: options.map((o) => ({
        id: o.id, name: o.name, price_delta: o.price_delta,
        stock_product_id: o.stock_product_id,
      })),
    });
  }
  return c.json(
    successEnvelope(
      {
        ...productOut(product),
        variants: variants.map((v) => ({
          id: v.id, name: v.name, price_delta: v.price_delta,
          sku_suffix: v.sku_suffix, version: v.version,
        })),
        modifiers,
      },
      c.get("requestId"),
    ),
    200,
  );
});

master.patch("/products/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  const body = parseWith(productPatch, await readJsonBody(c.req));
  const row = await fetchProduct(c.env.DB, user.outlet_id, id);
  try {
    await c.env.DB
      .prepare(
        `UPDATE products SET category_id = ?, name = ?, sku = ?, base_price = ?, cost_price = ?,
                is_stock_tracked = ?, image_key = ?, is_active = ?, updated_at = ?, version = version + 1
          WHERE id = ?`,
      )
      .bind(
        body.category_id !== undefined ? body.category_id : row.category_id,
        body.name ?? row.name,
        body.sku !== undefined ? body.sku : row.sku,
        body.base_price ?? row.base_price,
        body.cost_price ?? row.cost_price,
        body.is_stock_tracked !== undefined ? (body.is_stock_tracked ? 1 : 0) : row.is_stock_tracked,
        body.image_key !== undefined ? body.image_key : row.image_key,
        body.is_active !== undefined ? (body.is_active ? 1 : 0) : row.is_active,
        now(),
        id,
      )
      .run();
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      throw new ApiError("CONFLICT", "SKU sudah dipakai produk lain di outlet ini", {
        sku: body.sku,
      });
    }
    throw e;
  }
  const updated = await fetchProduct(c.env.DB, user.outlet_id, id);
  return c.json(successEnvelope(productOut(updated), c.get("requestId")), 200);
});

master.delete("/products/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  await fetchProduct(c.env.DB, user.outlet_id, id);
  const t = now();
  await c.env.DB
    .prepare("UPDATE products SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(t, t, id)
    .run();
  return c.json(successEnvelope({ id, deleted: true }, c.get("requestId")), 200);
});

// ---------------------------------------------------------------- variants

const variantCreate = z.object({
  name: z.string().min(1, "Nama varian wajib diisi"),
  price_delta: z.number().int().default(0),
  sku_suffix: z.string().nullable().optional(),
});
const variantPatch = variantCreate.partial();

master.post("/products/:id/variants", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const product = await fetchProduct(c.env.DB, user.outlet_id, c.req.param("id"));
  const body = parseWith(variantCreate, await readJsonBody(c.req));
  const t = now();
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      "INSERT INTO product_variants (id, outlet_id, product_id, name, price_delta, sku_suffix, created_at, updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)",
    )
    .bind(id, user.outlet_id, product.id, body.name, body.price_delta, body.sku_suffix ?? null, t, t)
    .run();
  const row = await getOr404<VariantRow>(
    c.env.DB, "SELECT * FROM product_variants WHERE id = ?", [id], "Varian",
  );
  return c.json(
    successEnvelope(
      { id: row.id, product_id: row.product_id, name: row.name, price_delta: row.price_delta, sku_suffix: row.sku_suffix, version: row.version },
      c.get("requestId"),
    ),
    201,
  );
});

master.patch("/variants/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  const body = parseWith(variantPatch, await readJsonBody(c.req));
  const row = await getOr404<VariantRow>(
    c.env.DB,
    "SELECT * FROM product_variants WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, user.outlet_id],
    "Varian",
  );
  await c.env.DB
    .prepare("UPDATE product_variants SET name = ?, price_delta = ?, sku_suffix = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(
      body.name ?? row.name,
      body.price_delta ?? row.price_delta,
      body.sku_suffix !== undefined ? body.sku_suffix : row.sku_suffix,
      now(),
      id,
    )
    .run();
  const updated = await getOr404<VariantRow>(
    c.env.DB, "SELECT * FROM product_variants WHERE id = ?", [id], "Varian",
  );
  return c.json(
    successEnvelope(
      { id: updated.id, product_id: updated.product_id, name: updated.name, price_delta: updated.price_delta, sku_suffix: updated.sku_suffix, version: updated.version },
      c.get("requestId"),
    ),
    200,
  );
});

master.delete("/variants/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  await getOr404<VariantRow>(
    c.env.DB,
    "SELECT * FROM product_variants WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, user.outlet_id],
    "Varian",
  );
  const t = now();
  await c.env.DB
    .prepare("UPDATE product_variants SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(t, t, id)
    .run();
  return c.json(successEnvelope({ id, deleted: true }, c.get("requestId")), 200);
});

// ---------------------------------------------------------------- modifiers

const optionInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Nama opsi wajib diisi"),
  price_delta: z.number().int().default(0),
  stock_product_id: z.string().nullable().optional(),
});
const modifierCreate = z.object({
  name: z.string().min(1, "Nama grup opsi wajib diisi"),
  selection_type: z.enum(["single", "multiple"]).default("single"),
  is_required: z.boolean().default(false),
  min_select: z.number().int().min(0).default(0),
  max_select: z.number().int().min(1).nullable().optional(),
  options: z.array(optionInput).default([]),
});
const modifierPatch = modifierCreate.partial();

async function modifierWithOptions(
  db: D1Database, outletId: string, modifierId: string,
) {
  const m = await getOr404<ModifierRow>(
    db,
    "SELECT * FROM modifiers WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [modifierId, outletId],
    "Grup opsi",
  );
  const { results: options } = await db
    .prepare("SELECT * FROM modifier_options WHERE modifier_id = ? AND outlet_id = ? AND deleted_at IS NULL ORDER BY name ASC")
    .bind(modifierId, outletId)
    .all<ModifierOptionRow>();
  return {
    id: m.id, outlet_id: outletId, name: m.name,
    selection_type: m.selection_type, is_required: bool(m.is_required),
    min_select: m.min_select, max_select: m.max_select, version: m.version,
    options: options.map((o) => ({
      id: o.id, name: o.name, price_delta: o.price_delta,
      stock_product_id: o.stock_product_id,
    })),
  };
}

async function insertOption(
  db: D1Database, outletId: string, modifierId: string,
  opt: z.infer<typeof optionInput>, t: number,
): Promise<string> {
  if (opt.stock_product_id) {
    await getOr404(
      db,
      "SELECT id FROM products WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
      [opt.stock_product_id, outletId],
      "Produk stok bahan",
    );
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO modifier_options (id, outlet_id, modifier_id, name, price_delta, stock_product_id, created_at, updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)",
    )
    .bind(id, outletId, modifierId, opt.name, opt.price_delta, opt.stock_product_id ?? null, t, t)
    .run();
  return id;
}

master.get("/modifiers", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB
    .prepare("SELECT id FROM modifiers WHERE outlet_id = ? AND deleted_at IS NULL ORDER BY name ASC")
    .bind(user.outlet_id)
    .all<{ id: string }>();
  const data = [];
  for (const r of results) {
    data.push(await modifierWithOptions(c.env.DB, user.outlet_id, r.id));
  }
  return c.json(successEnvelope(data, c.get("requestId")), 200);
});

master.post("/modifiers", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const body = parseWith(modifierCreate, await readJsonBody(c.req));
  const t = now();
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO modifiers (id, outlet_id, name, selection_type, is_required, min_select, max_select, created_at, updated_at, deleted_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
    )
    .bind(
      id, user.outlet_id, body.name, body.selection_type, body.is_required ? 1 : 0,
      body.min_select, body.max_select ?? null, t, t,
    )
    .run();
  for (const opt of body.options) {
    await insertOption(c.env.DB, user.outlet_id, id, opt, t);
  }
  const data = await modifierWithOptions(c.env.DB, user.outlet_id, id);
  return c.json(successEnvelope(data, c.get("requestId")), 201);
});

master.patch("/modifiers/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  const body = parseWith(modifierPatch, await readJsonBody(c.req));
  const row = await getOr404<ModifierRow>(
    c.env.DB,
    "SELECT * FROM modifiers WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, user.outlet_id],
    "Grup opsi",
  );
  const t = now();
  await c.env.DB
    .prepare(
      `UPDATE modifiers SET name = ?, selection_type = ?, is_required = ?, min_select = ?, max_select = ?,
              updated_at = ?, version = version + 1 WHERE id = ?`,
    )
    .bind(
      body.name ?? row.name,
      body.selection_type ?? row.selection_type,
      body.is_required !== undefined ? (body.is_required ? 1 : 0) : row.is_required,
      body.min_select ?? row.min_select,
      body.max_select !== undefined ? body.max_select : row.max_select,
      t,
      id,
    )
    .run();
  if (body.options !== undefined) {
    // Sinkronisasi opsi: yang dikirim dipertahankan/diperbarui, sisanya soft delete.
    const keep = new Set<string>();
    for (const opt of body.options) {
      if (opt.id) {
        const existing = await c.env.DB
          .prepare("SELECT id FROM modifier_options WHERE id = ? AND modifier_id = ? AND outlet_id = ? AND deleted_at IS NULL")
          .bind(opt.id, id, user.outlet_id)
          .first<{ id: string }>();
        if (existing) {
          await c.env.DB
            .prepare("UPDATE modifier_options SET name = ?, price_delta = ?, stock_product_id = ?, updated_at = ?, version = version + 1 WHERE id = ?")
            .bind(opt.name, opt.price_delta, opt.stock_product_id ?? null, t, opt.id)
            .run();
          keep.add(opt.id);
          continue;
        }
      }
      keep.add(await insertOption(c.env.DB, user.outlet_id, id, opt, t));
    }
    const { results: current } = await c.env.DB
      .prepare("SELECT id FROM modifier_options WHERE modifier_id = ? AND outlet_id = ? AND deleted_at IS NULL")
      .bind(id, user.outlet_id)
      .all<{ id: string }>();
    for (const cur of current) {
      if (!keep.has(cur.id)) {
        await c.env.DB
          .prepare("UPDATE modifier_options SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .bind(t, t, cur.id)
          .run();
      }
    }
  }
  const data = await modifierWithOptions(c.env.DB, user.outlet_id, id);
  return c.json(successEnvelope(data, c.get("requestId")), 200);
});

master.delete("/modifiers/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const id = c.req.param("id");
  await getOr404<ModifierRow>(
    c.env.DB,
    "SELECT * FROM modifiers WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [id, user.outlet_id],
    "Grup opsi",
  );
  const t = now();
  await c.env.DB
    .prepare("UPDATE modifiers SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(t, t, id)
    .run();
  await c.env.DB
    .prepare("UPDATE modifier_options SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE modifier_id = ? AND deleted_at IS NULL")
    .bind(t, t, id)
    .run();
  return c.json(successEnvelope({ id, deleted: true }, c.get("requestId")), 200);
});

// ------------------------------------------------------- product <-> modifier

const attachSchema = z.object({
  modifier_id: z.string().min(1),
  sort_order: z.number().int().default(0),
});

master.post("/products/:id/modifiers", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const product = await fetchProduct(c.env.DB, user.outlet_id, c.req.param("id"));
  const body = parseWith(attachSchema, await readJsonBody(c.req));
  await getOr404<ModifierRow>(
    c.env.DB,
    "SELECT * FROM modifiers WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL",
    [body.modifier_id, user.outlet_id],
    "Grup opsi",
  );
  const existing = await c.env.DB
    .prepare("SELECT id, deleted_at FROM product_modifiers WHERE product_id = ? AND modifier_id = ?")
    .bind(product.id, body.modifier_id)
    .first<{ id: string; deleted_at: number | null }>();
  const t = now();
  if (existing && existing.deleted_at == null) {
    throw new ApiError("CONFLICT", "Grup opsi sudah terpasang pada produk ini");
  }
  if (existing) {
    await c.env.DB
      .prepare("UPDATE product_modifiers SET deleted_at = NULL, sort_order = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .bind(body.sort_order, t, existing.id)
      .run();
  } else {
    await c.env.DB
      .prepare(
        "INSERT INTO product_modifiers (id, outlet_id, product_id, modifier_id, sort_order, created_at, updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)",
      )
      .bind(crypto.randomUUID(), user.outlet_id, product.id, body.modifier_id, body.sort_order, t, t)
      .run();
  }
  return c.json(
    successEnvelope(
      { product_id: product.id, modifier_id: body.modifier_id, sort_order: body.sort_order },
      c.get("requestId"),
    ),
    201,
  );
});

master.delete("/products/:id/modifiers/:modifierId", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const productId = c.req.param("id");
  const modifierId = c.req.param("modifierId");
  const link = await c.env.DB
    .prepare("SELECT id FROM product_modifiers WHERE product_id = ? AND modifier_id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(productId, modifierId, user.outlet_id)
    .first<{ id: string }>();
  if (!link) throw new ApiError("NOT_FOUND", "Penghubung produk-grup opsi tidak ditemukan");
  const t = now();
  await c.env.DB
    .prepare("UPDATE product_modifiers SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(t, t, link.id)
    .run();
  return c.json(
    successEnvelope({ product_id: productId, modifier_id: modifierId, deleted: true }, c.get("requestId")),
    200,
  );
});

export default master;
