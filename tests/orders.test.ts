/**
 * Test integrasi alur order terhadap Worker Hono dengan shim D1 in-memory
 * (node:sqlite) yang menjalankan migrasi 0001-0008 + seed demo asli.
 *
 * Skenario yang benar-benar diuji:
 * - login salah -> UNAUTHORIZED; login benar -> token; /auth/me.
 * - order tanpa shift terbuka -> SHIFT_NOT_OPEN.
 * - buka shift ganda -> CONFLICT.
 * - order contoh kontrak: total 42000; stok bahan berkurang tepat sekali.
 * - replay Idempotency-Key sama -> order yang sama, tanpa stok/order ganda.
 * - Idempotency-Key sama isi berbeda -> CONFLICT.
 * - pembayaran kurang -> PAYMENT_MISMATCH; tunai lebih -> kembalian tercatat
 *   dan order lunas; bayar lagi -> CONFLICT.
 * - stok tidak cukup -> INSUFFICIENT_STOCK.
 * - non-tunai pending; confirm oleh kasir -> FORBIDDEN; oleh owner -> lunas.
 * - dapur: antrean, transisi queued->cooking->done, transisi mundur CONFLICT.
 * - cancel order lunas -> CONFLICT; cancel order antre -> void.
 */
import { beforeAll, describe, expect, it } from "vitest";
import app from "../worker/index";
import { createTestDb, type TestDb } from "./helpers/d1";

const SEBLAK = "d0000000-0000-4000-8000-000000000001";
const ES_TEH = "d0000000-0000-4000-8000-000000000002";
const STOK_BAKSO = "d0000000-0000-4000-8000-000000000011";
const STOK_CEKER = "d0000000-0000-4000-8000-000000000012";
const STOK_TELUR = "d0000000-0000-4000-8000-000000000013";
const OPT_LEVEL1 = "f0000000-0000-4000-8000-000000000002";
const OPT_BAKSO = "f0000000-0000-4000-8000-000000000011";
const OPT_CEKER = "f0000000-0000-4000-8000-000000000012";
const OPT_TELUR = "f0000000-0000-4000-8000-000000000013";

interface Envelope<T> {
  data: T;
  meta: { request_id: string };
}
interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

let t: TestDb;
let kasirToken = "";
let ownerToken = "";
let order1Id = "";

async function call<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Envelope<T> & ErrorEnvelope }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(
    `http://test${path}`,
    {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    },
    { DB: t.db },
  );
  const json = (await res.json()) as Envelope<T> & ErrorEnvelope;
  return { status: res.status, json };
}

async function login(email: string, password: string): Promise<string> {
  const r = await call<{ token: string }>("POST", "/api/v1/auth/login", {
    body: { email, password },
  });
  expect(r.status).toBe(200);
  return r.json.data.token;
}

const kontrakItems = (qty: number) => [
  {
    product_id: SEBLAK,
    qty,
    modifiers: [
      { modifier_option_id: OPT_LEVEL1, qty: 1 },
      { modifier_option_id: OPT_BAKSO, qty: 2 },
      { modifier_option_id: OPT_CEKER, qty: 1 },
      { modifier_option_id: OPT_TELUR, qty: 1 },
    ],
  },
];

beforeAll(async () => {
  t = createTestDb(true);
});

describe("auth", () => {
  it("login kata sandi salah -> 401 UNAUTHORIZED", async () => {
    const r = await call("POST", "/api/v1/auth/login", {
      body: { email: "kasir@demo.seblakpos.id", password: "salah123" },
    });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
  });

  it("login benar -> token; /auth/me mengembalikan profil kasir", async () => {
    kasirToken = await login("kasir@demo.seblakpos.id", "seblak123");
    ownerToken = await login("owner@demo.seblakpos.id", "seblak123");
    const me = await call<{ role: string; email: string }>("GET", "/api/v1/auth/me", {
      token: kasirToken,
    });
    expect(me.status).toBe(200);
    expect(me.json.data.role).toBe("cashier");
    expect(me.json.data.email).toBe("kasir@demo.seblakpos.id");
  });

  it("tanpa token -> 401", async () => {
    const r = await call("GET", "/api/v1/products");
    expect(r.status).toBe(401);
  });
});

describe("shift & order", () => {
  it("order sebelum buka shift -> SHIFT_NOT_OPEN", async () => {
    const r = await call("POST", "/api/v1/orders", {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-pre-shift" },
      body: { items: kontrakItems(1) },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("SHIFT_NOT_OPEN");
  });

  it("buka shift berhasil; buka lagi -> CONFLICT", async () => {
    const open = await call("POST", "/api/v1/shifts/open", {
      token: kasirToken,
      body: { opening_cash: 100_000 },
    });
    expect(open.status).toBe(201);
    const again = await call("POST", "/api/v1/shifts/open", {
      token: kasirToken,
      body: { opening_cash: 0 },
    });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("CONFLICT");
  });

  it("order kontrak 2 porsi: total 42000 dan stok berkurang tepat sekali", async () => {
    const r = await call<{ id: string; subtotal: number; grand_total: number }>(
      "POST",
      "/api/v1/orders",
      {
        token: kasirToken,
        headers: { "Idempotency-Key": "idem-order-1" },
        body: { items: kontrakItems(2) },
      },
    );
    expect(r.status).toBe(201);
    expect(r.json.data.subtotal).toBe(42_000);
    expect(r.json.data.grand_total).toBe(42_000);
    order1Id = r.json.data.id;
    // Per porsi: bakso 2, ceker 1, telur 1 -> 2 porsi: 4/2/2 dari stok awal 100.
    expect(t.stockBalance(STOK_BAKSO)).toBe(96);
    expect(t.stockBalance(STOK_CEKER)).toBe(98);
    expect(t.stockBalance(STOK_TELUR)).toBe(98);
  });

  it("replay Idempotency-Key sama -> order sama, tanpa order/stok ganda", async () => {
    const r = await call<{ id: string }>("POST", "/api/v1/orders", {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-order-1" },
      body: { items: kontrakItems(2) },
    });
    expect(r.status).toBe(201);
    expect(r.json.data.id).toBe(order1Id);
    expect(t.scalar<number>("SELECT COUNT(*) FROM orders")).toBe(1);
    expect(t.stockBalance(STOK_BAKSO)).toBe(96);
  });

  it("Idempotency-Key sama dengan isi berbeda -> CONFLICT", async () => {
    const r = await call("POST", "/api/v1/orders", {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-order-1" },
      body: { items: kontrakItems(1) },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CONFLICT");
  });

  it("stok tidak cukup -> INSUFFICIENT_STOCK", async () => {
    const r = await call("POST", "/api/v1/orders", {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-order-stok" },
      body: {
        items: [
          {
            product_id: SEBLAK,
            qty: 1,
            modifiers: [
              { modifier_option_id: OPT_LEVEL1, qty: 1 },
              { modifier_option_id: OPT_BAKSO, qty: 200 },
            ],
          },
        ],
      },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("INSUFFICIENT_STOCK");
  });
});

describe("pembayaran tunai", () => {
  it("bayar kurang -> PAYMENT_MISMATCH", async () => {
    const r = await call("POST", `/api/v1/orders/${order1Id}/payments`, {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-pay-kurang" },
      body: { method: "cash", amount: 40_000 },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("PAYMENT_MISMATCH");
  });

  it("bayar tunai 50000 -> kembalian 8000 dan order lunas", async () => {
    const r = await call<{ change_amount: number; payment_status: string; order_status: string }>(
      "POST",
      `/api/v1/orders/${order1Id}/payments`,
      {
        token: kasirToken,
        headers: { "Idempotency-Key": "idem-pay-1" },
        body: { method: "cash", amount: 50_000 },
      },
    );
    expect(r.status).toBe(201);
    expect(r.json.data.change_amount).toBe(8_000);
    expect(r.json.data.payment_status).toBe("paid");
    expect(r.json.data.order_status).toBe("paid");
  });

  it("bayar lagi pada order lunas -> CONFLICT", async () => {
    const r = await call("POST", `/api/v1/orders/${order1Id}/payments`, {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-pay-2" },
      body: { method: "cash", amount: 42_000 },
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CONFLICT");
  });
});

describe("pembayaran non-tunai & dapur & cancel", () => {
  let order2Id = "";
  let payment2Id = "";

  it("order es teh + bayar qris -> pending, belum lunas", async () => {
    const o = await call<{ id: string; grand_total: number }>("POST", "/api/v1/orders", {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-order-2" },
      body: { items: [{ product_id: ES_TEH, qty: 1, modifiers: [] }] },
    });
    expect(o.status).toBe(201);
    expect(o.json.data.grand_total).toBe(5_000);
    order2Id = o.json.data.id;

    const p = await call<{ payment: { id: string; status: string }; payment_status: string }>(
      "POST",
      `/api/v1/orders/${order2Id}/payments`,
      {
        token: kasirToken,
        headers: { "Idempotency-Key": "idem-pay-qris" },
        body: { method: "qris", amount: 5_000, reference_no: "QRIS-TEST-1" },
      },
    );
    expect(p.status).toBe(201);
    expect(p.json.data.payment.status).toBe("pending");
    expect(p.json.data.payment_status).toBe("unpaid");
    payment2Id = p.json.data.payment.id;
  });

  it("confirm oleh kasir -> FORBIDDEN; oleh owner -> settled & lunas", async () => {
    const byKasir = await call("POST", `/api/v1/payments/${payment2Id}/confirm`, {
      token: kasirToken,
    });
    expect(byKasir.status).toBe(403);
    expect(byKasir.json.error.code).toBe("FORBIDDEN");

    const byOwner = await call<{ payment: { status: string }; order: { payment_status: string } | null }>(
      "POST",
      `/api/v1/payments/${payment2Id}/confirm`,
      { token: ownerToken },
    );
    expect(byOwner.status).toBe(200);
    expect(byOwner.json.data.payment.status).toBe("settled");
    expect(byOwner.json.data.order?.payment_status).toBe("paid");
  });

  it("dapur: antrean, transisi sah, transisi mundur -> CONFLICT", async () => {
    const queue = await call<{ id: string }[]>("GET", "/api/v1/kitchen/queue", {
      token: kasirToken,
    });
    expect(queue.status).toBe(200);
    expect(queue.json.data.some((o) => o.id === order1Id)).toBe(true);

    const cooking = await call<{ kitchen_status: string }>(
      "POST",
      `/api/v1/kitchen/orders/${order1Id}/status`,
      { token: kasirToken, body: { status: "cooking" } },
    );
    expect(cooking.status).toBe(200);
    expect(cooking.json.data.kitchen_status).toBe("cooking");

    const done = await call<{ kitchen_status: string; status: string }>(
      "POST",
      `/api/v1/kitchen/orders/${order1Id}/status`,
      { token: kasirToken, body: { status: "done" } },
    );
    expect(done.status).toBe(200);
    expect(done.json.data.kitchen_status).toBe("done");
    expect(done.json.data.status).toBe("completed");

    const backwards = await call("POST", `/api/v1/kitchen/orders/${order1Id}/status`, {
      token: kasirToken,
      body: { status: "cooking" },
    });
    expect(backwards.status).toBe(409);
    expect(backwards.json.error.code).toBe("CONFLICT");
  });

  it("cancel order yang sudah lunas -> CONFLICT", async () => {
    const r = await call("POST", `/api/v1/orders/${order2Id}/cancel`, {
      token: kasirToken,
    });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CONFLICT");
  });

  it("cancel order yang masih antre -> void", async () => {
    const o = await call<{ id: string }>("POST", "/api/v1/orders", {
      token: kasirToken,
      headers: { "Idempotency-Key": "idem-order-3" },
      body: { items: [{ product_id: ES_TEH, qty: 1, modifiers: [] }] },
    });
    expect(o.status).toBe(201);
    const r = await call<{ status: string }>(
      "POST",
      `/api/v1/orders/${o.json.data.id}/cancel`,
      { token: kasirToken },
    );
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe("void");
  });
});
