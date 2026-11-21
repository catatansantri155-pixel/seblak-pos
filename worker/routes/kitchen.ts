/**
 * Rute dapur:
 * - GET  /api/v1/kitchen/queue — order outlet ini yang kitchen_status-nya
 *   'queued' atau 'cooking' (dan belum void), beserta item-itemnya.
 * - POST /api/v1/kitchen/orders/:id/status — transisi sah hanya
 *   queued -> cooking -> done; selain itu CONFLICT. Saat menjadi 'done' dan
 *   order sudah lunas, orders.status ikut menjadi 'completed'.
 *
 * Status order, payment_status, dan kitchen_status adalah kolom terpisah
 * (migrasi 0008) dan tidak saling menimpa.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { parseWith, readJsonBody } from "../lib/validate";
import { fetchOrder, orderOut } from "./orders";
import type { Env, Variables } from "../lib/types";

const kitchen = new Hono<{ Bindings: Env; Variables: Variables }>();

kitchen.get("/kitchen/queue", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM orders
        WHERE outlet_id = ? AND deleted_at IS NULL AND status != 'void'
          AND kitchen_status IN ('queued', 'cooking')
        ORDER BY created_at ASC`,
    )
    .bind(user.outlet_id)
    .all<Parameters<typeof orderOut>[0]>();
  const data = [];
  for (const o of results) {
    const { results: items } = await c.env.DB
      .prepare(
        `SELECT oi.id, oi.product_id, p.name AS product_name, oi.qty, oi.note
           FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ? AND oi.outlet_id = ? AND oi.deleted_at IS NULL
          ORDER BY oi.created_at ASC`,
      )
      .bind(o.id, user.outlet_id)
      .all<{ id: string; product_id: string | null; product_name: string | null; qty: number; note: string | null }>();
    const outItems = [];
    for (const it of items) {
      const { results: mods } = await c.env.DB
        .prepare("SELECT name_snapshot, qty FROM order_item_modifiers WHERE order_item_id = ? AND outlet_id = ? AND deleted_at IS NULL")
        .bind(it.id, user.outlet_id)
        .all<{ name_snapshot: string | null; qty: number }>();
      outItems.push({
        id: it.id, product_id: it.product_id, product_name: it.product_name,
        qty: it.qty, note: it.note,
        modifiers: mods.map((m) => ({ name: m.name_snapshot, qty: m.qty })),
      });
    }
    data.push({ ...orderOut(o), items: outItems });
  }
  return c.json(successEnvelope(data, c.get("requestId")), 200);
});

const statusSchema = z.object({
  status: z.enum(["queued", "cooking", "done"]),
});

const NEXT: Record<string, string> = { queued: "cooking", cooking: "done" };

kitchen.post("/kitchen/orders/:id/status", async (c) => {
  const user = c.get("user");
  const body = parseWith(statusSchema, await readJsonBody(c.req));
  const order = await fetchOrder(c.env.DB, user.outlet_id, c.req.param("id"));
  if (order.status === "void") {
    throw new ApiError("CONFLICT", "Order sudah dibatalkan");
  }
  const expected = NEXT[order.kitchen_status];
  if (body.status !== expected) {
    throw new ApiError(
      "CONFLICT",
      `Transisi dapur tidak sah: ${order.kitchen_status} -> ${body.status}`,
      { kitchen_status: order.kitchen_status, requested: body.status },
    );
  }
  const t = Date.now();
  const completeNow = body.status === "done" && order.payment_status === "paid";
  await c.env.DB
    .prepare(
      `UPDATE orders SET kitchen_status = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    )
    .bind(body.status, completeNow ? "completed" : order.status, t, order.id)
    .run();
  const updated = await fetchOrder(c.env.DB, user.outlet_id, order.id);
  return c.json(successEnvelope(orderOut(updated), c.get("requestId")), 200);
});

export default kitchen;
