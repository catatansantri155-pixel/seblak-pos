/**
 * Rute pembayaran:
 * - POST /api/v1/orders/:id/payments — Idempotency-Key wajib.
 *   Metode mengikuti skema G1a: 'cash' | 'qris' | 'edc' | 'transfer'
 *   (tiga terakhir = pembayaran non-tunai manual).
 *   Jumlah harus menutup sisa tagihan: kurang -> PAYMENT_MISMATCH.
 *   Tunai boleh lebih; kembalian dihitung server dan tercatat di
 *   payments.change_amount. Non-tunai tidak boleh lebih (PAYMENT_MISMATCH).
 *   Tunai langsung 'settled'; non-tunai berstatus 'pending' sampai dikonfirmasi.
 *   Order yang sudah lunas tidak bisa dibayar lagi (CONFLICT).
 * - POST /api/v1/payments/:id/confirm — hanya owner/manager (kasir pembuat
 *   tidak bisa mengonfirmasi pembayaran non-tunainya sendiri). Mengubah
 *   pembayaran pending menjadi settled dan memperbarui payment_status order.
 *
 * Alokasi: satu baris payment_allocations sebesar porsi yang menutup order
 * (untuk tunai berlebih, alokasi = sisa tagihan, bukan uang yang diserahkan).
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { parseWith, readJsonBody } from "../lib/validate";
import { requireRole } from "../lib/auth";
import {
  findStoredResponse,
  hashRequestBody,
  requireIdempotencyKey,
  storeResponse,
} from "../lib/idempotency";
import { fetchOrder, refreshPaymentStatus, settledPaidTotal } from "./orders";
import type { AuthUser, Env, Variables } from "../lib/types";

const payments = new Hono<{ Bindings: Env; Variables: Variables }>();

const createPaymentSchema = z.object({
  method: z.enum(["cash", "qris", "edc", "transfer"]),
  amount: z.number().int().min(1, "Jumlah pembayaran minimal 1"),
  reference_no: z.string().nullable().optional(),
  client_tx_id: z.string().min(1).nullable().optional(),
});

interface PaymentRow {
  id: string; outlet_id: string; order_id: string | null; shift_id: string | null;
  method: string; amount: number; change_amount: number; status: string;
  reference_no: string | null; client_tx_id: string | null;
  created_at: number; updated_at: number; version: number;
}

const paymentOut = (r: PaymentRow) => ({
  id: r.id, outlet_id: r.outlet_id, order_id: r.order_id, shift_id: r.shift_id,
  method: r.method, amount: r.amount, change_amount: r.change_amount,
  status: r.status, reference_no: r.reference_no, client_tx_id: r.client_tx_id,
  created_at: r.created_at, updated_at: r.updated_at, version: r.version,
});

async function fetchPayment(
  db: D1Database, outletId: string, id: string,
): Promise<PaymentRow> {
  const row = await db
    .prepare("SELECT * FROM payments WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(id, outletId)
    .first<PaymentRow>();
  if (!row) throw new ApiError("NOT_FOUND", "Pembayaran tidak ditemukan");
  return row;
}

/**
 * Inti pembuatan pembayaran — dipakai rute POST /orders/:id/payments DAN
 * sinkronisasi offline (worker/routes/sync.ts) agar aturan PAYMENT_MISMATCH,
 * kembalian, dan status pending non-tunai persis sama. idemKey null berarti
 * tanpa lapisan Idempotency-Key (jalur sync memakai client_tx_id pembayaran
 * + sync_events sebagai idempotensinya).
 */
export async function createPaymentCore(
  db: D1Database,
  user: AuthUser,
  orderId: string,
  rawBody: unknown,
  idemKey: string | null,
): Promise<{ status: number; data: unknown }> {
  const body = parseWith(createPaymentSchema, rawBody);

  let scopedKey = "";
  let requestHash = "";
  if (idemKey) {
    scopedKey = `pay:${orderId}:${idemKey}`;
    requestHash = await hashRequestBody(rawBody);
    const stored = await findStoredResponse(db, user.outlet_id, scopedKey, requestHash);
    if (stored) {
      return { status: stored.status_code, data: JSON.parse(stored.response_json) };
    }
  }

  const order = await fetchOrder(db, user.outlet_id, orderId);
  if (order.status === "void") {
    throw new ApiError("CONFLICT", "Order sudah dibatalkan dan tidak bisa dibayar");
  }
  const alreadyPaid = await settledPaidTotal(db, user.outlet_id, order.id);
  const remaining = order.grand_total - alreadyPaid;
  if (remaining <= 0) {
    throw new ApiError("CONFLICT", "Order sudah lunas; pembayaran ganda ditolak");
  }
  if (body.amount < remaining) {
    throw new ApiError("PAYMENT_MISMATCH", "Jumlah pembayaran kurang dari sisa tagihan", {
      remaining, amount: body.amount,
    });
  }
  const isCash = body.method === "cash";
  if (!isCash && body.amount > remaining) {
    throw new ApiError("PAYMENT_MISMATCH", "Pembayaran non-tunai harus pas dengan sisa tagihan", {
      remaining, amount: body.amount,
    });
  }
  const change = isCash ? body.amount - remaining : 0;
  const applied = remaining;
  const status = isCash ? "settled" : "pending";

  if (body.client_tx_id) {
    const dup = await db
      .prepare("SELECT id FROM payments WHERE outlet_id = ? AND client_tx_id = ?")
      .bind(user.outlet_id, body.client_tx_id)
      .first<{ id: string }>();
    if (dup) {
      throw new ApiError("CONFLICT", "client_tx_id pembayaran sudah dipakai", {
        client_tx_id: body.client_tx_id,
      });
    }
  }

  const t = Date.now();
  const paymentId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO payments (id, outlet_id, order_id, shift_id, method, amount, change_amount,
                status, reference_no, client_tx_id, created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
      )
      .bind(
        paymentId, user.outlet_id, order.id, order.shift_id, body.method,
        body.amount, change, status, body.reference_no ?? null,
        body.client_tx_id ?? null, t, t,
      ),
    db
      .prepare(
        `INSERT INTO payment_allocations (id, outlet_id, payment_id, order_id, amount,
                created_at, updated_at, deleted_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
      )
      .bind(crypto.randomUUID(), user.outlet_id, paymentId, order.id, applied, t, t),
  ]);

  const payment = await fetchPayment(db, user.outlet_id, paymentId);
  let refreshed = order;
  if (status === "settled") {
    refreshed = await refreshPaymentStatus(db, user.outlet_id, order);
  }
  const data = {
    payment: paymentOut(payment),
    order_id: order.id,
    applied_amount: applied,
    change_amount: change,
    payment_status: refreshed.payment_status,
    order_status: refreshed.status,
  };
  if (idemKey) {
    await storeResponse(db, user.outlet_id, scopedKey, requestHash, 201, data);
  }
  return { status: 201, data };
}

payments.post("/orders/:id/payments", async (c) => {
  const user = c.get("user");
  const rawBody = await readJsonBody(c.req);
  const idemKey = requireIdempotencyKey(c.req.header("Idempotency-Key"));
  const result = await createPaymentCore(
    c.env.DB, user, c.req.param("id"), rawBody, idemKey,
  );
  return c.json(
    successEnvelope(result.data, c.get("requestId")),
    result.status as 201,
  );
});

payments.post("/payments/:id/confirm", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const payment = await fetchPayment(db, user.outlet_id, c.req.param("id"));
  if (payment.status !== "pending") {
    throw new ApiError("CONFLICT", "Hanya pembayaran pending yang bisa dikonfirmasi", {
      status: payment.status,
    });
  }
  const t = Date.now();
  await db
    .prepare("UPDATE payments SET status = 'settled', updated_at = ?, version = version + 1 WHERE id = ?")
    .bind(t, payment.id)
    .run();
  let orderInfo: { payment_status: string; status: string } | null = null;
  if (payment.order_id) {
    const order = await fetchOrder(db, user.outlet_id, payment.order_id);
    const refreshed = await refreshPaymentStatus(db, user.outlet_id, order);
    orderInfo = { payment_status: refreshed.payment_status, status: refreshed.status };
  }
  const updated = await fetchPayment(db, user.outlet_id, payment.id);
  return c.json(
    successEnvelope({ payment: paymentOut(updated), order: orderInfo }, c.get("requestId")),
    200,
  );
});

export default payments;
