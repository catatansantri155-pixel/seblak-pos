/**
 * Rute sinkronisasi offline (kontrak G1b modul Sinkronisasi):
 * - POST /api/v1/sync/push — batch event dari klien offline. Setiap event
 *   membawa client_tx_id unik per outlet dan diproses IDEMPOTEN:
 *   client_tx_id yang sudah pernah diterima dijawab 'duplicate' (atau
 *   verdict penolakan aslinya) TANPA efek ganda; event tidak valid dijawab
 *   'rejected' + kode error per event; event lain dalam batch yang sama
 *   tetap diproses. Hasil per event: accepted | duplicate | rejected.
 *   Order offline melewati createOrderCore yang sama dengan jalur online
 *   (harga dihitung server, aturan stok & shift berlaku); pembayaran
 *   offline melewati createPaymentCore (non-tunai tetap 'pending').
 *   Setiap event dicatat di sync_events (applied = accepted,
 *   conflict = rejected; alasan penolakan disimpan di payload_json).
 * - GET  /api/v1/sync/pull?since=<ISO 8601 | epoch ms> — perubahan sejak
 *   titik waktu itu: kategori, produk, modifier & opsinya yang berubah
 *   (updated_at > since, TERMASUK yang soft-deleted agar klien membuangnya)
 *   dan status order outlet yang berubah untuk menyegarkan antrean lokal.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { parseWith, readJsonBody } from "../lib/validate";
import { createOrderCore } from "./orders";
import { createPaymentCore } from "./payments";
import type { AuthUser, Env, Variables } from "../lib/types";

const sync = new Hono<{ Bindings: Env; Variables: Variables }>();

const pushSchema = z.object({
  events: z
    .array(
      z.object({
        client_tx_id: z.string().min(1),
        entity: z.enum(["order", "payment"]),
        payload: z.record(z.unknown()),
      }),
    )
    .min(1, "Batch harus berisi minimal 1 event")
    .max(100, "Maksimal 100 event per push"),
});

interface SyncEventRow {
  id: string; status: string; entity: string; entity_id: string | null;
  payload_json: string | null;
}

interface EventResult {
  client_tx_id: string;
  entity: string;
  status: "accepted" | "duplicate" | "rejected";
  entity_id?: string | null;
  error?: { code: string; message: string };
}

async function recordSyncEvent(
  db: D1Database,
  user: AuthUser,
  ev: { client_tx_id: string; entity: string },
  status: "applied" | "conflict",
  entityId: string | null,
  payloadJson: string,
): Promise<void> {
  const t = Date.now();
  await db
    .prepare(
      `INSERT INTO sync_events (id, outlet_id, client_tx_id, entity, entity_id,
              payload_json, status, received_at, applied_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), user.outlet_id, ev.client_tx_id, ev.entity,
      entityId, payloadJson, status, t, status === "applied" ? t : null, t,
    )
    .run();
}

async function processEvent(
  db: D1Database,
  user: AuthUser,
  ev: { client_tx_id: string; entity: "order" | "payment"; payload: Record<string, unknown> },
): Promise<EventResult> {
  // Sudah pernah diterima? Jawab verdict lama tanpa efek ganda.
  const existing = await db
    .prepare("SELECT * FROM sync_events WHERE outlet_id = ? AND client_tx_id = ?")
    .bind(user.outlet_id, ev.client_tx_id)
    .first<SyncEventRow>();
  if (existing) {
    if (existing.status === "applied") {
      return {
        client_tx_id: ev.client_tx_id, entity: ev.entity,
        status: "duplicate", entity_id: existing.entity_id,
      };
    }
    // Penolakan lama: kembalikan alasan aslinya agar klien tidak menebak.
    let message = "Event pernah ditolak";
    let code = "VALIDATION_ERROR";
    if (existing.payload_json) {
      try {
        const parsed = JSON.parse(existing.payload_json) as {
          __sync_error?: { code?: string; message?: string };
        };
        if (parsed.__sync_error) {
          code = parsed.__sync_error.code ?? code;
          message = parsed.__sync_error.message ?? message;
        }
      } catch { /* payload lama tidak terbaca; pakai pesan umum */ }
    }
    return {
      client_tx_id: ev.client_tx_id, entity: ev.entity,
      status: "rejected", error: { code, message },
    };
  }

  try {
    let entityId: string | null = null;
    if (ev.entity === "order") {
      const payload = { ...ev.payload, client_tx_id: ev.client_tx_id };
      const result = await createOrderCore(db, user, payload, null);
      entityId = (result.data as { id: string }).id;
    } else {
      // Pembayaran: order dirujuk lewat order_id atau order_client_tx_id
      // (order offline yang baru disinkronkan belum tentu dikenal id-nya).
      const p = ev.payload;
      let orderId: string | null =
        typeof p["order_id"] === "string" ? (p["order_id"] as string) : null;
      if (!orderId && typeof p["order_client_tx_id"] === "string") {
        const row = await db
          .prepare("SELECT id FROM orders WHERE outlet_id = ? AND client_tx_id = ?")
          .bind(user.outlet_id, p["order_client_tx_id"] as string)
          .first<{ id: string }>();
        orderId = row?.id ?? null;
      }
      if (!orderId) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "Pembayaran offline tidak merujuk order yang dikenal",
          { order_id: "order_id / order_client_tx_id tidak ditemukan" },
        );
      }
      const paymentBody = {
        method: p["method"],
        amount: p["amount"],
        reference_no: p["reference_no"] ?? null,
        client_tx_id: ev.client_tx_id,
      };
      const result = await createPaymentCore(db, user, orderId, paymentBody, null);
      entityId = (result.data as { payment: { id: string } }).payment.id;
    }
    await recordSyncEvent(
      db, user, ev, "applied", entityId, JSON.stringify(ev.payload),
    );
    return {
      client_tx_id: ev.client_tx_id, entity: ev.entity,
      status: "accepted", entity_id: entityId,
    };
  } catch (err) {
    const code = err instanceof ApiError ? err.code : "INTERNAL_ERROR";
    const message =
      err instanceof ApiError
        ? err.message
        : "Kesalahan internal saat memproses event";
    if (!(err instanceof ApiError)) {
      console.error("sync push event error", ev.client_tx_id, err);
    }
    await recordSyncEvent(
      db, user, ev, "conflict", null,
      JSON.stringify({ payload: ev.payload, __sync_error: { code, message } }),
    );
    return {
      client_tx_id: ev.client_tx_id, entity: ev.entity,
      status: "rejected", error: { code, message },
    };
  }
}

sync.post("/sync/push", async (c) => {
  const user = c.get("user");
  const body = parseWith(pushSchema, await readJsonBody(c.req));
  const results: EventResult[] = [];
  for (const ev of body.events) {
    results.push(await processEvent(c.env.DB, user, ev));
  }
  return c.json(
    successEnvelope(
      {
        results,
        accepted: results.filter((r) => r.status === "accepted").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        rejected: results.filter((r) => r.status === "rejected").length,
      },
      c.get("requestId"),
    ),
    200,
  );
});

// ------------------------------------------------------------------- pull

function parseSince(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return parsed;
  throw new ApiError("VALIDATION_ERROR", "Parameter since tidak sah", {
    since: "Gunakan ISO 8601 atau epoch milidetik",
  });
}

sync.get("/sync/pull", async (c) => {
  const user = c.get("user");
  const db = c.env.DB;
  const since = parseSince(c.req.query("since"));
  const LIMIT = 500;

  const changed = async <T>(table: string): Promise<T[]> => {
    const { results } = await db
      .prepare(
        `SELECT * FROM ${table} WHERE outlet_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT ?`,
      )
      .bind(user.outlet_id, since, LIMIT)
      .all<T>();
    return results;
  };

  const categories = await changed("categories");
  const products = await changed("products");
  const modifiers = await changed("modifiers");
  const modifierOptions = await changed("modifier_options");
  const { results: orders } = await db
    .prepare(
      `SELECT id, order_no, type, status, payment_status, kitchen_status,
              cashier_id, shift_id, subtotal, discount_total, tax_total,
              grand_total, client_tx_id, updated_at
         FROM orders
        WHERE outlet_id = ? AND updated_at > ? AND deleted_at IS NULL
        ORDER BY updated_at ASC LIMIT ?`,
    )
    .bind(user.outlet_id, since, LIMIT)
    .all<Record<string, unknown>>();

  return c.json(
    successEnvelope(
      {
        since,
        server_time: Date.now(),
        categories,
        products,
        modifiers,
        modifier_options: modifierOptions,
        orders,
      },
      c.get("requestId"),
    ),
    200,
  );
});

export default sync;
