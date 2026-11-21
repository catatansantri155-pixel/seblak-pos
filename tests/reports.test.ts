/**
 * Test laporan (Metric Dictionary Lestari) terhadap Worker + shim D1.
 *
 * Skenario (semua pada hari berjalan Asia/Jakarta):
 * - Order A: 2 porsi kontrak = 42.000, dibayar tunai 50.000 -> settled
 *   (applied 42.000, kembalian 8.000 BUKAN penerimaan — prinsip 6 Lestari).
 * - Order B: 2 es teh = 10.000, dibayar qris -> pending, lalu dikonfirmasi
 *   owner -> settled.
 * - Order C: 1 es teh, tidak dibayar (tetap open/unpaid).
 * - Order D: 1 es teh, dibuat lalu dibatalkan (void).
 *
 * Hitungan tangan yang diverifikasi pada /reports/daily:
 * - gross (M-01) = 42.000 + 10.000 = 52.000 (hanya order lunas A & B;
 *   C belum lunas dan D void tidak masuk pendapatan).
 * - diskon (M-02) = 0; refund (M-03) = 0; net (M-04) = 52.000.
 * - transaksi lunas (M-06) = 2; AOV (M-07) = 52.000 / 2 = 26.000.
 * - per metode (M-05): cash settled applied 42.000 (bukan 50.000 tendered),
 *   qris settled 10.000, pending 0 setelah konfirmasi.
 * - status: paid 2, open 1, void 1; payment_status: paid 2, unpaid 2.
 * - kasir mengakses laporan -> FORBIDDEN.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/d1";
import {
  makeClient, kontrakItems, ES_TEH, SEBLAK, CAT_SEBLAK,
} from "./helpers/api";

let t: TestDb;
let call: ReturnType<typeof makeClient>["call"];
let kasirToken = "";
let ownerToken = "";
let shiftId = "";

interface DailyReport {
  gross_sales: number; discount_total: number; refund_total: number;
  net_sales: number; tax_total: number; paid_transaction_count: number;
  average_order_value: number | null;
  orders_by_status: Record<string, number>;
  orders_by_payment_status: Record<string, number>;
  payment_methods: {
    method: string; settled_amount: number; settled_count: number;
    pending_amount: number; net_collected: number;
  }[];
  shifts: { id: string; settled_cash_amount: number; orders_count: number }[];
}

beforeAll(async () => {
  t = createTestDb(true);
  const client = makeClient(t);
  call = client.call;
  kasirToken = await client.login("kasir@demo.seblakpos.id", "seblak123");
  ownerToken = await client.login("owner@demo.seblakpos.id", "seblak123");

  const open = await call<{ id: string }>("POST", "/api/v1/shifts/open", {
    token: kasirToken, body: { opening_cash: 100_000 },
  });
  expect(open.status).toBe(201);
  shiftId = open.json.data.id;

  // Order A — kontrak 2 porsi, tunai 50.000.
  const a = await call<{ id: string }>("POST", "/api/v1/orders", {
    token: kasirToken, headers: { "Idempotency-Key": "rep-order-a" },
    body: { items: kontrakItems(2) },
  });
  expect(a.status).toBe(201);
  const payA = await call("POST", `/api/v1/orders/${a.json.data.id}/payments`, {
    token: kasirToken, headers: { "Idempotency-Key": "rep-pay-a" },
    body: { method: "cash", amount: 50_000 },
  });
  expect(payA.status).toBe(201);

  // Order B — 2 es teh, qris pending lalu dikonfirmasi owner.
  const b = await call<{ id: string }>("POST", "/api/v1/orders", {
    token: kasirToken, headers: { "Idempotency-Key": "rep-order-b" },
    body: { items: [{ product_id: ES_TEH, qty: 2, modifiers: [] }] },
  });
  expect(b.status).toBe(201);
  const payB = await call<{ payment: { id: string } }>(
    "POST", `/api/v1/orders/${b.json.data.id}/payments`,
    {
      token: kasirToken, headers: { "Idempotency-Key": "rep-pay-b" },
      body: { method: "qris", amount: 10_000, reference_no: "QRIS-REP-1" },
    },
  );
  expect(payB.status).toBe(201);
  const confirm = await call("POST", `/api/v1/payments/${payB.json.data.payment.id}/confirm`, {
    token: ownerToken,
  });
  expect(confirm.status).toBe(200);

  // Order C — tidak dibayar.
  const cOrder = await call<{ id: string }>("POST", "/api/v1/orders", {
    token: kasirToken, headers: { "Idempotency-Key": "rep-order-c" },
    body: { items: [{ product_id: ES_TEH, qty: 1, modifiers: [] }] },
  });
  expect(cOrder.status).toBe(201);

  // Order D — dibuat lalu dibatalkan.
  const d = await call<{ id: string }>("POST", "/api/v1/orders", {
    token: kasirToken, headers: { "Idempotency-Key": "rep-order-d" },
    body: { items: [{ product_id: ES_TEH, qty: 1, modifiers: [] }] },
  });
  expect(d.status).toBe(201);
  const cancel = await call("POST", `/api/v1/orders/${d.json.data.id}/cancel`, {
    token: kasirToken,
  });
  expect(cancel.status).toBe(200);
});

describe("reports/daily", () => {
  it("kasir mengakses laporan -> 403 FORBIDDEN", async () => {
    const r = await call("GET", "/api/v1/reports/daily", { token: kasirToken });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("FORBIDDEN");
  });

  it("angka harian cocok dengan hitungan tangan (M-01..M-07)", async () => {
    const r = await call<DailyReport>("GET", "/api/v1/reports/daily", {
      token: ownerToken,
    });
    expect(r.status).toBe(200);
    const d = r.json.data;
    expect(d.gross_sales).toBe(52_000);
    expect(d.discount_total).toBe(0);
    expect(d.refund_total).toBe(0);
    expect(d.net_sales).toBe(52_000);
    expect(d.tax_total).toBe(0);
    expect(d.paid_transaction_count).toBe(2);
    expect(d.average_order_value).toBe(26_000);
    expect(d.orders_by_status.paid).toBe(2);
    expect(d.orders_by_status.open).toBe(1);
    expect(d.orders_by_status.void).toBe(1);
    expect(d.orders_by_payment_status.paid).toBe(2);
    expect(d.orders_by_payment_status.unpaid).toBe(2);

    const cash = d.payment_methods.find((m) => m.method === "cash");
    expect(cash?.settled_amount).toBe(42_000); // applied, bukan 50.000 tendered
    expect(cash?.settled_count).toBe(1);
    expect(cash?.net_collected).toBe(42_000);
    const qris = d.payment_methods.find((m) => m.method === "qris");
    expect(qris?.settled_amount).toBe(10_000);
    expect(qris?.pending_amount).toBe(0);
    const transfer = d.payment_methods.find((m) => m.method === "transfer");
    expect(transfer?.settled_amount).toBe(0);

    expect(d.shifts).toHaveLength(1);
    expect(d.shifts[0]?.id).toBe(shiftId);
    expect(d.shifts[0]?.settled_cash_amount).toBe(42_000);
    expect(d.shifts[0]?.orders_count).toBe(4);
  });

  it("tanggal lampau -> semua nol dan AOV null", async () => {
    const r = await call<DailyReport>(
      "GET", "/api/v1/reports/daily?date=2020-01-05", { token: ownerToken },
    );
    expect(r.status).toBe(200);
    expect(r.json.data.gross_sales).toBe(0);
    expect(r.json.data.paid_transaction_count).toBe(0);
    expect(r.json.data.average_order_value).toBeNull();
  });
});

describe("reports/products & categories", () => {
  it("produk terlaris: seblak di atas, es teh kedua (M-08)", async () => {
    const r = await call<{
      items: { product_id: string; qty_sold: number; gross_revenue: number; order_count: number }[];
    }>("GET", "/api/v1/reports/products", { token: ownerToken });
    expect(r.status).toBe(200);
    const items = r.json.data.items;
    expect(items).toHaveLength(2);
    expect(items[0]?.product_id).toBe(SEBLAK);
    expect(items[0]?.qty_sold).toBe(2);
    expect(items[0]?.gross_revenue).toBe(42_000);
    expect(items[0]?.order_count).toBe(1);
    expect(items[1]?.product_id).toBe(ES_TEH);
    expect(items[1]?.qty_sold).toBe(2);
    expect(items[1]?.gross_revenue).toBe(10_000);
  });

  it("per kategori: Seblak 42.000, Minuman 10.000", async () => {
    const r = await call<{
      items: { category_id: string; qty_sold: number; gross_revenue: number }[];
    }>("GET", "/api/v1/reports/categories", { token: ownerToken });
    expect(r.status).toBe(200);
    const seblak = r.json.data.items.find((i) => i.category_id === CAT_SEBLAK);
    expect(seblak?.gross_revenue).toBe(42_000);
    expect(seblak?.qty_sold).toBe(2);
    const minuman = r.json.data.items.find((i) => i.category_id !== CAT_SEBLAK);
    expect(minuman?.gross_revenue).toBe(10_000);
  });
});

describe("reports/shift/:id", () => {
  it("rekonsiliasi shift cocok dengan M-12 (expected 142.000)", async () => {
    const r = await call<{
      reconciliation: {
        opening_cash: number; cash_receipts_settled: number;
        cash_refunds: number; cash_movements_total: number;
        expected_cash_computed: number; counted_cash: number | null;
        difference_computed: number | null;
      };
      orders: { id: string }[];
    }>("GET", `/api/v1/reports/shift/${shiftId}`, { token: ownerToken });
    expect(r.status).toBe(200);
    const rec = r.json.data.reconciliation;
    expect(rec.opening_cash).toBe(100_000);
    expect(rec.cash_receipts_settled).toBe(42_000);
    expect(rec.cash_refunds).toBe(0);
    expect(rec.cash_movements_total).toBe(0);
    expect(rec.expected_cash_computed).toBe(142_000);
    expect(rec.counted_cash).toBeNull(); // shift masih terbuka
    expect(rec.difference_computed).toBeNull();
    expect(r.json.data.orders).toHaveLength(4);
  });

  it("shift tidak dikenal -> 404 NOT_FOUND", async () => {
    const r = await call("GET", "/api/v1/reports/shift/tidak-ada", {
      token: ownerToken,
    });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe("NOT_FOUND");
  });
});
