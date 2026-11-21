/**
 * Test sinkronisasi offline (G4a) terhadap Worker + shim D1:
 * - push batch berisi order offline + pembayaran offline (merujuk
 *   order_client_tx_id) + satu event rusak: dua accepted, satu rejected
 *   per event dengan kode VALIDATION_ERROR; event sah tetap diproses.
 * - order offline melewati harga server (total 21.000) dan stok berkurang.
 * - push ulang batch yang sama: accepted menjadi duplicate, rejected
 *   mengembalikan alasan asli; TIDAK ada order/stok ganda.
 * - pull?since mengembalikan produk yang berubah setelah titik waktu itu
 *   (produk baru yang dibuat owner sesudahnya muncul; format ISO diterima).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/d1";
import { makeClient, kontrakItems, STOK_BAKSO } from "./helpers/api";

let t: TestDb;
let call: ReturnType<typeof makeClient>["call"];
let kasirToken = "";
let ownerToken = "";

interface PushResult {
  results: {
    client_tx_id: string; entity: string;
    status: "accepted" | "duplicate" | "rejected";
    entity_id?: string | null;
    error?: { code: string; message: string };
  }[];
  accepted: number; duplicates: number; rejected: number;
}

const batch = {
  events: [
    {
      client_tx_id: "offline-order-1",
      entity: "order",
      payload: { type: "takeaway", items: kontrakItems(1) },
    },
    {
      client_tx_id: "offline-pay-1",
      entity: "payment",
      payload: {
        order_client_tx_id: "offline-order-1",
        method: "cash",
        amount: 21_000,
      },
    },
    {
      client_tx_id: "offline-order-rusak",
      entity: "order",
      payload: {
        items: [{ product_id: "produk-tidak-ada", qty: 1, modifiers: [] }],
      },
    },
  ],
};

beforeAll(async () => {
  t = createTestDb(true);
  const client = makeClient(t);
  call = client.call;
  kasirToken = await client.login("kasir@demo.seblakpos.id", "seblak123");
  ownerToken = await client.login("owner@demo.seblakpos.id", "seblak123");
  const open = await call("POST", "/api/v1/shifts/open", {
    token: kasirToken, body: { opening_cash: 50_000 },
  });
  expect(open.status).toBe(201);
});

describe("sync/push", () => {
  it("batch campuran: 2 accepted, 1 rejected per event", async () => {
    const r = await call<PushResult>("POST", "/api/v1/sync/push", {
      token: kasirToken, body: batch,
    });
    expect(r.status).toBe(200);
    expect(r.json.data.accepted).toBe(2);
    expect(r.json.data.rejected).toBe(1);
    const byTx = new Map(r.json.data.results.map((x) => [x.client_tx_id, x]));
    expect(byTx.get("offline-order-1")?.status).toBe("accepted");
    expect(byTx.get("offline-pay-1")?.status).toBe("accepted");
    const bad = byTx.get("offline-order-rusak");
    expect(bad?.status).toBe("rejected");
    expect(bad?.error?.code).toBe("VALIDATION_ERROR");

    // Order benar-benar tercipta dengan harga server & stok berkurang.
    expect(t.scalar<number>("SELECT COUNT(*) FROM orders")).toBe(1);
    expect(
      t.scalar<number>("SELECT grand_total FROM orders"),
    ).toBe(21_000);
    expect(
      t.scalar<string>("SELECT payment_status FROM orders"),
    ).toBe("paid");
    expect(t.stockBalance(STOK_BAKSO)).toBe(98); // 100 - 2 bakso per porsi
    expect(
      t.scalar<number>("SELECT COUNT(*) FROM sync_events"),
    ).toBe(3);
  });

  it("push ulang batch sama: duplicate & rejected asli, tanpa efek ganda", async () => {
    const r = await call<PushResult>("POST", "/api/v1/sync/push", {
      token: kasirToken, body: batch,
    });
    expect(r.status).toBe(200);
    expect(r.json.data.accepted).toBe(0);
    expect(r.json.data.duplicates).toBe(2);
    expect(r.json.data.rejected).toBe(1);
    const byTx = new Map(r.json.data.results.map((x) => [x.client_tx_id, x]));
    expect(byTx.get("offline-order-1")?.status).toBe("duplicate");
    expect(byTx.get("offline-pay-1")?.status).toBe("duplicate");
    expect(byTx.get("offline-order-rusak")?.error?.code).toBe("VALIDATION_ERROR");

    expect(t.scalar<number>("SELECT COUNT(*) FROM orders")).toBe(1);
    expect(t.scalar<number>("SELECT COUNT(*) FROM payments")).toBe(1);
    expect(t.stockBalance(STOK_BAKSO)).toBe(98);
  });
});

describe("sync/pull", () => {
  it("produk yang berubah setelah since muncul di pull (epoch & ISO)", async () => {
    const created = await call<{ id: string; updated_at: number }>("POST", "/api/v1/products", {
      token: ownerToken,
      body: { name: "Seblak Ceker Spesial", base_price: 15_000, sku: "SBL-CKR" },
    });
    expect(created.status).toBe(201);
    const { id: newId, updated_at: updatedAt } = created.json.data;
    const before = updatedAt - 1;

    const pull = await call<{ products: { id: string }[]; orders: { id: string }[] }>(
      "GET", `/api/v1/sync/pull?since=${before}`, { token: kasirToken },
    );
    expect(pull.status).toBe(200);
    expect(pull.json.data.products.some((p) => p.id === newId)).toBe(true);
    // Gunakan since=0 untuk memeriksa order offline secara terpisah.
    const pullAll = await call<{ orders: { payment_status: string }[] }>(
      "GET", "/api/v1/sync/pull?since=0", { token: kasirToken },
    );
    expect(pullAll.json.data.orders).toHaveLength(1);
    expect(pullAll.json.data.orders[0]?.payment_status).toBe("paid");

    const pullIso = await call<{ products: { id: string }[] }>(
      "GET",
      `/api/v1/sync/pull?since=${encodeURIComponent(new Date(before).toISOString())}`,
      { token: kasirToken },
    );
    expect(pullIso.status).toBe(200);
    expect(pullIso.json.data.products.some((p) => p.id === newId)).toBe(true);
  });
});
