/**
 * Rute laporan (kontrak G1b modul Laporan) — hanya owner/manager.
 *
 * Definisi angka mengikuti Metric Dictionary Lestari (artefak Living World
 * id 6, "G1 — Metric Dictionary & Rumus Rekonsiliasi", v1.0):
 * - M-01 Penjualan Kotor  = Σ (qty x harga snapshot) = Σ orders.subtotal
 *   HANYA pada transaksi LUNAS (payment_status = 'paid'); draft/pending/
 *   bayar sebagian/void TIDAK pernah menjadi pendapatan (prinsip 1 & 2.2).
 * - M-02 Diskon Total     = Σ orders.discount_total pada transaksi lunas.
 * - M-03 Refund Total     = Σ alokasi pembayaran berstatus 'refunded' pada
 *   periode refund terjadi (basis periode refunded_at; transaksi asal tidak
 *   diedit mundur — prinsip 5). Skema tidak punya tabel refund tersendiri;
 *   refunded_at diwakili payments.updated_at saat status menjadi 'refunded'.
 * - M-04 Penjualan Bersih = M-01 - M-02 - M-03.
 * - M-05 Cash Collected per metode = Σ amount APPLIED (payment_allocations,
 *   BUKAN amount yang ditenderkan — kembalian bukan penerimaan, prinsip 6)
 *   dari pembayaran settled, dikurangi refund per metode; pembayaran
 *   'pending' dilaporkan terpisah dan tidak masuk penerimaan.
 * - M-06 Transaksi Lunas  = COUNT order payment_status='paid'.
 * - M-07 AOV = M-04 / M-06; bila M-06 = 0 hasilnya null ("—"), bukan 0.
 * - M-08 Produk Terlaris  = ranking per produk dari order lunas: qty dan
 *   revenue kotor (line_total + line_discount = qty x harga snapshot).
 * - M-12 Selisih Kas Shift = counted - expected; expected = opening
 *   + penerimaan tunai settled (applied) - refund tunai + mutasi kas.
 *
 * Penyimpangan yang disadari dari dictionary (dicatat, bukan disembunyikan):
 * - Dictionary memakai paid_at sebagai basis periode penjualan; skema G1a
 *   tidak punya kolom paid_at, jadi basis periode order lunas memakai
 *   orders.created_at pada hari yang sama (order dibuat dan dilunasi pada
 *   alur kasir normal memang berurutan di hari yang sama).
 * - HPP (M-10) & Margin Kotor Estimasi (M-11) TIDAK dihitung di sini:
 *   order_items tidak menyimpan biaya resep snapshot, jadi angka HPP apa
 *   pun akan mengarang. Menunggu kolom snapshot biaya di gate berikutnya.
 * - Identitas R-2 dictionary (Σ cash collected = penjualan bersih) hanya
 *   balance bila pajak 0, karena M-04 tidak mengurangi pajak sedangkan
 *   alokasi pembayaran menutup grand_total (termasuk pajak). tax_total
 *   dilaporkan terpisah agar selisih ini transparan.
 *
 * Semua tanggal laporan adalah hari kalender Asia/Jakarta (UTC+7 tetap);
 * rentang efektif dikembalikan di data.period karena meta envelope G1b
 * tidak punya tempat untuknya.
 */
import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { successEnvelope } from "../lib/envelope";
import { requireRole } from "../lib/auth";
import { parsePagination } from "../lib/validate";
import { settledCashTotal, cashMovementsTotal, type ShiftRow } from "./shifts";
import type { Env, Variables } from "../lib/types";

const reports = new Hono<{ Bindings: Env; Variables: Variables }>();

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const METHODS = ["cash", "qris", "edc", "transfer"] as const;

/** Awal hari (epoch ms) untuk tanggal kalender Asia/Jakarta YYYY-MM-DD. */
function jakartaDayStart(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) {
    throw new ApiError("VALIDATION_ERROR", "Format tanggal harus YYYY-MM-DD", {
      date: dateStr,
    });
  }
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    throw new ApiError("VALIDATION_ERROR", "Tanggal tidak sah", { date: dateStr });
  }
  return utc - JAKARTA_OFFSET_MS;
}

function jakartaToday(): string {
  const nowJkt = new Date(Date.now() + JAKARTA_OFFSET_MS);
  const y = nowJkt.getUTCFullYear();
  const mo = String(nowJkt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nowJkt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Parameter from/to: terima YYYY-MM-DD (hari Jakarta) atau epoch ms. */
function parseRange(c: { req: { query: (k: string) => string | undefined } }): {
  from: number; to: number;
} {
  const rawFrom = c.req.query("from");
  const rawTo = c.req.query("to");
  let from: number;
  let to: number;
  if (rawFrom === undefined) {
    from = jakartaDayStart(jakartaToday());
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawFrom)) {
    from = jakartaDayStart(rawFrom);
  } else if (Number.isFinite(Number(rawFrom))) {
    from = Number(rawFrom);
  } else {
    throw new ApiError("VALIDATION_ERROR", "Parameter from tidak sah", { from: rawFrom });
  }
  if (rawTo === undefined) {
    to = from + DAY_MS;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawTo)) {
    to = jakartaDayStart(rawTo) + DAY_MS; // inklusif sampai akhir hari 'to'
  } else if (Number.isFinite(Number(rawTo))) {
    to = Number(rawTo);
  } else {
    throw new ApiError("VALIDATION_ERROR", "Parameter to tidak sah", { to: rawTo });
  }
  if (to <= from) {
    throw new ApiError("VALIDATION_ERROR", "Rentang tanggal kosong", {
      from: rawFrom ?? null, to: rawTo ?? null,
    });
  }
  return { from, to };
}

// ---------------------------------------------------------------- daily

reports.get("/reports/daily", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const date = c.req.query("date") ?? jakartaToday();
  const from = jakartaDayStart(date);
  const to = from + DAY_MS;

  // Order lunas pada hari laporan (basis cohort order; lihat catatan paid_at).
  const paidAgg = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal), 0) AS gross,
              COALESCE(SUM(discount_total), 0) AS discount,
              COALESCE(SUM(tax_total), 0) AS tax,
              COALESCE(SUM(grand_total), 0) AS grand
         FROM orders
        WHERE outlet_id = ? AND deleted_at IS NULL AND payment_status = 'paid'
          AND created_at >= ? AND created_at < ?`,
    )
    .bind(user.outlet_id, from, to)
    .first<{ n: number; gross: number; discount: number; tax: number; grand: number }>();

  // Refund pada periode refund (M-03): alokasi pembayaran 'refunded'.
  const refundAgg = await db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) AS n, COALESCE(SUM(pa.amount), 0) AS total
         FROM payments p
         JOIN payment_allocations pa ON pa.payment_id = p.id
        WHERE pa.outlet_id = ? AND p.status = 'refunded'
          AND p.deleted_at IS NULL AND pa.deleted_at IS NULL
          AND p.updated_at >= ? AND p.updated_at < ?`,
    )
    .bind(user.outlet_id, from, to)
    .first<{ n: number; total: number }>();

  const grossSales = paidAgg?.gross ?? 0;
  const discountTotal = paidAgg?.discount ?? 0;
  const refundTotal = refundAgg?.total ?? 0;
  const netSales = grossSales - discountTotal - refundTotal; // M-04
  const paidCount = paidAgg?.n ?? 0;
  const aov = paidCount > 0 ? Math.round(netSales / paidCount) : null; // M-07

  // Jumlah order per status (semua order yang dibuat hari itu).
  const { results: byStatus } = await db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM orders
        WHERE outlet_id = ? AND deleted_at IS NULL
          AND created_at >= ? AND created_at < ?
        GROUP BY status`,
    )
    .bind(user.outlet_id, from, to)
    .all<{ status: string; n: number }>();
  const { results: byPayStatus } = await db
    .prepare(
      `SELECT payment_status, COUNT(*) AS n FROM orders
        WHERE outlet_id = ? AND deleted_at IS NULL
          AND created_at >= ? AND created_at < ?
        GROUP BY payment_status`,
    )
    .bind(user.outlet_id, from, to)
    .all<{ payment_status: string; n: number }>();
  const ordersByStatus: Record<string, number> = {
    open: 0, paid: 0, completed: 0, void: 0,
  };
  for (const r of byStatus) ordersByStatus[r.status] = r.n;
  const ordersByPaymentStatus: Record<string, number> = {
    unpaid: 0, partial: 0, paid: 0,
  };
  for (const r of byPayStatus) ordersByPaymentStatus[r.payment_status] = r.n;

  // Per metode pembayaran (M-05): settled & pending dari created_at
  // pembayaran; refund dari updated_at (periode refund).
  const paymentMethods: Record<string, unknown>[] = [];
  for (const method of METHODS) {
    const settled = await db
      .prepare(
        `SELECT COUNT(DISTINCT p.id) AS n, COALESCE(SUM(pa.amount), 0) AS total
           FROM payments p
           JOIN payment_allocations pa ON pa.payment_id = p.id
          WHERE pa.outlet_id = ? AND p.method = ? AND p.status = 'settled'
            AND p.deleted_at IS NULL AND pa.deleted_at IS NULL
            AND p.created_at >= ? AND p.created_at < ?`,
      )
      .bind(user.outlet_id, method, from, to)
      .first<{ n: number; total: number }>();
    const pending = await db
      .prepare(
        `SELECT COUNT(DISTINCT p.id) AS n, COALESCE(SUM(pa.amount), 0) AS total
           FROM payments p
           JOIN payment_allocations pa ON pa.payment_id = p.id
          WHERE pa.outlet_id = ? AND p.method = ? AND p.status = 'pending'
            AND p.deleted_at IS NULL AND pa.deleted_at IS NULL
            AND p.created_at >= ? AND p.created_at < ?`,
      )
      .bind(user.outlet_id, method, from, to)
      .first<{ n: number; total: number }>();
    const refunded = await db
      .prepare(
        `SELECT COUNT(DISTINCT p.id) AS n, COALESCE(SUM(pa.amount), 0) AS total
           FROM payments p
           JOIN payment_allocations pa ON pa.payment_id = p.id
          WHERE pa.outlet_id = ? AND p.method = ? AND p.status = 'refunded'
            AND p.deleted_at IS NULL AND pa.deleted_at IS NULL
            AND p.updated_at >= ? AND p.updated_at < ?`,
      )
      .bind(user.outlet_id, method, from, to)
      .first<{ n: number; total: number }>();
    paymentMethods.push({
      method,
      settled_count: settled?.n ?? 0,
      settled_amount: settled?.total ?? 0,
      pending_count: pending?.n ?? 0,
      pending_amount: pending?.total ?? 0,
      refunded_count: refunded?.n ?? 0,
      refunded_amount: refunded?.total ?? 0,
      net_collected: (settled?.total ?? 0) - (refunded?.total ?? 0),
    });
  }

  // Ringkasan shift yang dibuka pada hari laporan.
  const { results: shiftRows } = await db
    .prepare(
      `SELECT * FROM cash_shifts
        WHERE outlet_id = ? AND deleted_at IS NULL
          AND opened_at >= ? AND opened_at < ?
        ORDER BY opened_at ASC`,
    )
    .bind(user.outlet_id, from, to)
    .all<ShiftRow>();
  const shifts = [];
  for (const s of shiftRows) {
    const cashSettled = await settledCashTotal(db, user.outlet_id, s.id);
    const orderCount = await db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE shift_id = ? AND outlet_id = ? AND deleted_at IS NULL")
      .bind(s.id, user.outlet_id)
      .first<{ n: number }>();
    shifts.push({
      id: s.id, cashier_id: s.cashier_id, status: s.status,
      opened_at: s.opened_at, closed_at: s.closed_at,
      opening_cash: s.opening_cash, expected_cash: s.expected_cash,
      counted_cash: s.counted_cash, difference: s.difference,
      settled_cash_amount: cashSettled, orders_count: orderCount?.n ?? 0,
    });
  }

  return c.json(
    successEnvelope(
      {
        period: { date, from, to, timezone: "Asia/Jakarta" },
        gross_sales: grossSales,
        discount_total: discountTotal,
        refund_total: refundTotal,
        refunds_count: refundAgg?.n ?? 0,
        net_sales: netSales,
        tax_total: paidAgg?.tax ?? 0,
        paid_orders_total: paidAgg?.grand ?? 0,
        paid_transaction_count: paidCount,
        average_order_value: aov,
        orders_by_status: ordersByStatus,
        orders_by_payment_status: ordersByPaymentStatus,
        payment_methods: paymentMethods,
        shifts,
      },
      c.get("requestId"),
    ),
    200,
  );
});

// ------------------------------------------------------------- products

reports.get("/reports/products", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const { from, to } = parseRange(c);
  const { page, perPage, limit, offset } = parsePagination(c.req.query());

  const total = await db
    .prepare(
      `SELECT COUNT(DISTINCT oi.product_id) AS n
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.outlet_id = ? AND oi.deleted_at IS NULL AND o.deleted_at IS NULL
          AND o.payment_status = 'paid' AND o.status != 'void'
          AND o.created_at >= ? AND o.created_at < ?`,
    )
    .bind(user.outlet_id, from, to)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(
      `SELECT oi.product_id AS product_id, p.name AS product_name,
              p.category_id AS category_id,
              SUM(oi.qty) AS qty_sold,
              SUM(oi.line_total + oi.line_discount) AS gross_revenue,
              SUM(oi.line_total) AS net_item_revenue,
              COUNT(DISTINCT oi.order_id) AS order_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.outlet_id = ? AND oi.deleted_at IS NULL AND o.deleted_at IS NULL
          AND o.payment_status = 'paid' AND o.status != 'void'
          AND o.created_at >= ? AND o.created_at < ?
        GROUP BY oi.product_id
        ORDER BY gross_revenue DESC, qty_sold DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(user.outlet_id, from, to, limit, offset)
    .all<{
      product_id: string | null; product_name: string | null;
      category_id: string | null; qty_sold: number; gross_revenue: number;
      net_item_revenue: number; order_count: number;
    }>();

  return c.json(
    successEnvelope(
      {
        period: { from, to, timezone: "Asia/Jakarta" },
        items: results.map((r) => ({
          product_id: r.product_id, product_name: r.product_name,
          category_id: r.category_id, qty_sold: r.qty_sold,
          gross_revenue: r.gross_revenue, net_item_revenue: r.net_item_revenue,
          order_count: r.order_count,
        })),
      },
      c.get("requestId"),
      { page, per_page: perPage, total: total?.n ?? 0 },
    ),
    200,
  );
});

// ------------------------------------------------------------ categories

reports.get("/reports/categories", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const { from, to } = parseRange(c);
  const { page, perPage, limit, offset } = parsePagination(c.req.query());

  const total = await db
    .prepare(
      `SELECT COUNT(DISTINCT p.category_id) AS n
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.outlet_id = ? AND oi.deleted_at IS NULL AND o.deleted_at IS NULL
          AND o.payment_status = 'paid' AND o.status != 'void'
          AND o.created_at >= ? AND o.created_at < ?`,
    )
    .bind(user.outlet_id, from, to)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(
      `SELECT p.category_id AS category_id, cat.name AS category_name,
              SUM(oi.qty) AS qty_sold,
              SUM(oi.line_total + oi.line_discount) AS gross_revenue,
              SUM(oi.line_total) AS net_item_revenue,
              COUNT(DISTINCT oi.order_id) AS order_count,
              COUNT(DISTINCT oi.product_id) AS product_count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE oi.outlet_id = ? AND oi.deleted_at IS NULL AND o.deleted_at IS NULL
          AND o.payment_status = 'paid' AND o.status != 'void'
          AND o.created_at >= ? AND o.created_at < ?
        GROUP BY p.category_id
        ORDER BY gross_revenue DESC, qty_sold DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(user.outlet_id, from, to, limit, offset)
    .all<{
      category_id: string | null; category_name: string | null;
      qty_sold: number; gross_revenue: number; net_item_revenue: number;
      order_count: number; product_count: number;
    }>();

  return c.json(
    successEnvelope(
      {
        period: { from, to, timezone: "Asia/Jakarta" },
        items: results.map((r) => ({
          category_id: r.category_id, category_name: r.category_name,
          qty_sold: r.qty_sold, gross_revenue: r.gross_revenue,
          net_item_revenue: r.net_item_revenue, order_count: r.order_count,
          product_count: r.product_count,
        })),
      },
      c.get("requestId"),
      { page, per_page: perPage, total: total?.n ?? 0 },
    ),
    200,
  );
});

// -------------------------------------------------------- shift reconcile

reports.get("/reports/shift/:id", async (c) => {
  const user = requireRole(c, "owner", "manager");
  const db = c.env.DB;
  const shiftId = c.req.param("id");
  const shift = await db
    .prepare("SELECT * FROM cash_shifts WHERE id = ? AND outlet_id = ? AND deleted_at IS NULL")
    .bind(shiftId, user.outlet_id)
    .first<ShiftRow>();
  if (!shift) throw new ApiError("NOT_FOUND", "Shift tidak ditemukan");

  const cashReceipts = await settledCashTotal(db, user.outlet_id, shiftId);
  const movementsTotal = await cashMovementsTotal(db, shiftId);
  const { results: movements } = await db
    .prepare("SELECT id, type, amount, reason, created_by, created_at FROM cash_movements WHERE shift_id = ? ORDER BY created_at ASC")
    .bind(shiftId)
    .all<{ id: string; type: string; amount: number; reason: string | null; created_by: string | null; created_at: number }>();

  // Refund tunai pada shift (M-12: mengurangi kas expected).
  const refundRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT p.id) AS n, COALESCE(SUM(pa.amount), 0) AS total
         FROM payments p
         JOIN payment_allocations pa ON pa.payment_id = p.id
        WHERE pa.outlet_id = ? AND p.shift_id = ? AND p.method = 'cash'
          AND p.status = 'refunded' AND p.deleted_at IS NULL AND pa.deleted_at IS NULL`,
    )
    .bind(user.outlet_id, shiftId)
    .first<{ n: number; total: number }>();
  const cashRefunds = refundRow?.total ?? 0;

  // Expected per M-12 Lestari (termasuk pengurang refund tunai). Bila shift
  // sudah ditutup, nilai tersimpan dari penutupan shift ikut ditampilkan;
  // keduanya sama selama belum ada pembayaran refunded (fitur refund
  // pembayaran belum punya endpoint penulis di sistem ini).
  const expectedComputed =
    shift.opening_cash + movementsTotal + cashReceipts - cashRefunds;
  const counted = shift.counted_cash;
  const differenceComputed =
    counted != null ? counted - expectedComputed : null;

  const { results: orders } = await db
    .prepare(
      `SELECT id, order_no, status, payment_status, kitchen_status,
              subtotal, discount_total, tax_total, grand_total, created_at
         FROM orders
        WHERE shift_id = ? AND outlet_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC`,
    )
    .bind(shiftId, user.outlet_id)
    .all<{
      id: string; order_no: string; status: string; payment_status: string;
      kitchen_status: string; subtotal: number; discount_total: number;
      tax_total: number; grand_total: number; created_at: number;
    }>();

  // Penerimaan settled per metode di dalam shift.
  const { results: methodRows } = await db
    .prepare(
      `SELECT p.method AS method, COUNT(DISTINCT p.id) AS n,
              COALESCE(SUM(pa.amount), 0) AS total
         FROM payments p
         JOIN payment_allocations pa ON pa.payment_id = p.id
        WHERE pa.outlet_id = ? AND p.shift_id = ? AND p.status = 'settled'
          AND p.deleted_at IS NULL AND pa.deleted_at IS NULL
        GROUP BY p.method`,
    )
    .bind(user.outlet_id, shiftId)
    .all<{ method: string; n: number; total: number }>();

  return c.json(
    successEnvelope(
      {
        shift: {
          id: shift.id, cashier_id: shift.cashier_id, status: shift.status,
          opened_at: shift.opened_at, closed_at: shift.closed_at,
          opening_cash: shift.opening_cash,
          expected_cash: shift.expected_cash,
          counted_cash: shift.counted_cash,
          difference: shift.difference,
        },
        reconciliation: {
          opening_cash: shift.opening_cash,
          cash_receipts_settled: cashReceipts,
          cash_refunds: cashRefunds,
          cash_movements_total: movementsTotal,
          expected_cash_computed: expectedComputed,
          counted_cash: counted,
          difference_computed: differenceComputed,
        },
        cash_movements: movements,
        payment_methods_settled: methodRows.map((r) => ({
          method: r.method, count: r.n, amount: r.total,
        })),
        orders,
      },
      c.get("requestId"),
    ),
    200,
  );
});

export default reports;
