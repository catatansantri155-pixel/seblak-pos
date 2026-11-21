/**
 * Test promo berkode (G4a, migrasi 0009) terhadap Worker + shim D1:
 * - owner membuat promo percent 10% berkode HEMAT10 (plafon 5.000).
 * - kode dobel -> CONFLICT; config tidak sah -> VALIDATION_ERROR;
 *   kasir membuat promo -> FORBIDDEN (aturan Fajar 9).
 * - order memakai promotion_ids dan promotion_codes menghasilkan diskon
 *   yang sama persis (10% x 42.000 = 4.200, di bawah plafon).
 * - kode tak dikenal -> VALIDATION_ERROR.
 * - promo yang dinonaktifkan ditolak saat dipakai (aturan Fajar 8).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/d1";
import { makeClient, kontrakItems } from "./helpers/api";

let t: TestDb;
let call: ReturnType<typeof makeClient>["call"];
let kasirToken = "";
let ownerToken = "";
let promoId = "";

beforeAll(async () => {
  t = createTestDb(true);
  const client = makeClient(t);
  call = client.call;
  kasirToken = await client.login("kasir@demo.seblakpos.id", "seblak123");
  ownerToken = await client.login("owner@demo.seblakpos.id", "seblak123");
  const open = await call("POST", "/api/v1/shifts/open", {
    token: kasirToken, body: { opening_cash: 0 },
  });
  expect(open.status).toBe(201);
});

async function orderWith(
  extra: Record<string, unknown>,
  key: string,
): Promise<{ status: number; json: { data: { discount_total: number; grand_total: number }; error: { code: string } } }> {
  return call("POST", "/api/v1/orders", {
    token: kasirToken,
    headers: { "Idempotency-Key": key },
    body: { items: kontrakItems(2), ...extra },
  }) as Promise<{ status: number; json: { data: { discount_total: number; grand_total: number }; error: { code: string } } }>;
}

describe("promotions CRUD", () => {
  it("owner membuat promo berkode; kode dobel -> CONFLICT", async () => {
    const r = await call<{ id: string; code: string | null }>(
      "POST", "/api/v1/promotions",
      {
        token: ownerToken,
        body: {
          name: "Hemat 10 Persen", code: "HEMAT10", type: "percent",
          config: { percent: 10 }, max_discount: 5_000,
        },
      },
    );
    expect(r.status).toBe(201);
    expect(r.json.data.code).toBe("HEMAT10");
    promoId = r.json.data.id;

    const dup = await call("POST", "/api/v1/promotions", {
      token: ownerToken,
      body: {
        name: "Tiru Kode", code: "HEMAT10", type: "percent",
        config: { percent: 5 },
      },
    });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("CONFLICT");
  });

  it("config tidak sah -> VALIDATION_ERROR; kasir membuat -> FORBIDDEN", async () => {
    const bad = await call("POST", "/api/v1/promotions", {
      token: ownerToken,
      body: { name: "Persen Kosong", type: "percent", config: {} },
    });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe("VALIDATION_ERROR");

    const byKasir = await call("POST", "/api/v1/promotions", {
      token: kasirToken,
      body: { name: "Dari Kasir", type: "nominal", config: { amount: 1_000 } },
    });
    expect(byKasir.status).toBe(403);
    expect(byKasir.json.error.code).toBe("FORBIDDEN");
  });

  it("kasir melihat promo aktif lewat GET /promotions", async () => {
    const r = await call<{ id: string; code: string | null }[]>(
      "GET", "/api/v1/promotions", { token: kasirToken },
    );
    expect(r.status).toBe(200);
    expect(r.json.data.some((p) => p.code === "HEMAT10")).toBe(true);
  });
});

describe("promotions pada order", () => {
  it("promotion_ids dan promotion_codes memberi diskon yang sama (4.200)", async () => {
    const byIds = await orderWith({ promotion_ids: [promoId] }, "promo-order-ids");
    expect(byIds.status).toBe(201);
    expect(byIds.json.data.discount_total).toBe(4_200);
    expect(byIds.json.data.grand_total).toBe(37_800);

    const byCodes = await orderWith({ promotion_codes: ["HEMAT10"] }, "promo-order-codes");
    expect(byCodes.status).toBe(201);
    expect(byCodes.json.data.discount_total).toBe(byIds.json.data.discount_total);
    expect(byCodes.json.data.grand_total).toBe(byIds.json.data.grand_total);
  });

  it("kode tak dikenal -> VALIDATION_ERROR", async () => {
    const r = await orderWith({ promotion_codes: ["NGACO"] }, "promo-order-ngaco");
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION_ERROR");
  });

  it("promo dinonaktifkan -> ditolak saat dipakai", async () => {
    const patch = await call("PATCH", `/api/v1/promotions/${promoId}`, {
      token: ownerToken, body: { is_active: false },
    });
    expect(patch.status).toBe(200);
    const r = await orderWith({ promotion_codes: ["HEMAT10"] }, "promo-order-off");
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION_ERROR");
  });
});
