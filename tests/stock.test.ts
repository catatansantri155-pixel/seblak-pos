/**
 * Test stok lanjutan (G4a) terhadap Worker + shim D1:
 * - balances mencerminkan agregat stock_movements seed (100 per bahan).
 * - purchase oleh kasir menambah saldo (150 setelah +50).
 * - waste oleh kasir -> FORBIDDEN (hanya owner/manager).
 * - waste melebihi saldo -> INSUFFICIENT_STOCK.
 * - adjustment tanpa note -> VALIDATION_ERROR.
 * - waste oleh owner dengan note berhasil; balances teragregat ulang.
 * - replay Idempotency-Key yang sama tidak menggandakan gerakan.
 * - riwayat movements terfilter per produk.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/d1";
import { makeClient, STOK_BAKSO } from "./helpers/api";

let t: TestDb;
let call: ReturnType<typeof makeClient>["call"];
let kasirToken = "";
let ownerToken = "";

interface Balance {
  product_id: string; balance: number; min_stock: number; low_stock: boolean;
}

async function balances(token: string): Promise<Balance[]> {
  const r = await call<Balance[]>("GET", "/api/v1/stock/balances", { token });
  expect(r.status).toBe(200);
  return r.json.data;
}

beforeAll(async () => {
  t = createTestDb(true);
  const client = makeClient(t);
  call = client.call;
  kasirToken = await client.login("kasir@demo.seblakpos.id", "seblak123");
  ownerToken = await client.login("owner@demo.seblakpos.id", "seblak123");
});

describe("stock balances & movements", () => {
  it("saldo awal dari seed: bakso 100, belum low_stock", async () => {
    const rows = await balances(kasirToken);
    const bakso = rows.find((r) => r.product_id === STOK_BAKSO);
    expect(bakso?.balance).toBe(100);
    expect(bakso?.min_stock).toBe(0);
    expect(bakso?.low_stock).toBe(false);
  });

  it("purchase oleh kasir +50 -> saldo 150", async () => {
    const r = await call<{ balance_after: number }>(
      "POST", "/api/v1/stock/movements",
      {
        token: kasirToken,
        headers: { "Idempotency-Key": "stok-purchase-1" },
        body: { product_id: STOK_BAKSO, type: "purchase", qty_delta: 50, note: "Belanja pasar" },
      },
    );
    expect(r.status).toBe(201);
    expect(r.json.data.balance_after).toBe(150);

    // Replay kunci yang sama: gerakan tidak ganda, saldo tetap 150.
    const replay = await call<{ balance_after: number }>(
      "POST", "/api/v1/stock/movements",
      {
        token: kasirToken,
        headers: { "Idempotency-Key": "stok-purchase-1" },
        body: { product_id: STOK_BAKSO, type: "purchase", qty_delta: 50, note: "Belanja pasar" },
      },
    );
    expect(replay.status).toBe(201);
    expect(replay.json.data.balance_after).toBe(150);
    expect(t.stockBalance(STOK_BAKSO)).toBe(150);
  });

  it("waste oleh kasir -> 403 FORBIDDEN", async () => {
    const r = await call("POST", "/api/v1/stock/movements", {
      token: kasirToken,
      headers: { "Idempotency-Key": "stok-waste-kasir" },
      body: { product_id: STOK_BAKSO, type: "waste", qty_delta: -5, note: "Basi" },
    });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("FORBIDDEN");
  });

  it("adjustment tanpa note -> 422 VALIDATION_ERROR", async () => {
    const r = await call("POST", "/api/v1/stock/movements", {
      token: ownerToken,
      headers: { "Idempotency-Key": "stok-adj-nonote" },
      body: { product_id: STOK_BAKSO, type: "adjustment", qty_delta: -3 },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION_ERROR");
  });

  it("waste melebihi saldo -> 422 INSUFFICIENT_STOCK", async () => {
    const r = await call("POST", "/api/v1/stock/movements", {
      token: ownerToken,
      headers: { "Idempotency-Key": "stok-waste-besar" },
      body: { product_id: STOK_BAKSO, type: "waste", qty_delta: -200, note: "Tumpah semua" },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("INSUFFICIENT_STOCK");
    expect(t.stockBalance(STOK_BAKSO)).toBe(150);
  });

  it("waste oleh owner -10 -> saldo 140; balances & riwayat konsisten", async () => {
    const r = await call<{ balance_after: number }>(
      "POST", "/api/v1/stock/movements",
      {
        token: ownerToken,
        headers: { "Idempotency-Key": "stok-waste-1" },
        body: { product_id: STOK_BAKSO, type: "waste", qty_delta: -10, note: "Bakso basi" },
      },
    );
    expect(r.status).toBe(201);
    expect(r.json.data.balance_after).toBe(140);

    const rows = await balances(ownerToken);
    expect(rows.find((x) => x.product_id === STOK_BAKSO)?.balance).toBe(140);

    const hist = await call<{ type: string; qty_delta: number }[]>(
      "GET", `/api/v1/stock/movements?product_id=${STOK_BAKSO}`,
      { token: ownerToken },
    );
    expect(hist.status).toBe(200);
    // seed purchase 100 + purchase 50 + waste -10 (replay tidak dihitung).
    expect(hist.json.meta.pagination?.total).toBe(3);
    const waste = hist.json.data.find((m) => m.type === "waste");
    expect(waste?.qty_delta).toBe(-10);
  });
});
