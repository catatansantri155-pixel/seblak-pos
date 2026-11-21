import { afterEach, expect, it, vi } from "vitest";
import { addOutboxEntry, loadOutbox, type OutboxEntry } from "../src/lib/outbox";
import { ES_TEH, makeClient } from "./helpers/api";
import { createTestDb } from "./helpers/d1";

afterEach(() => vi.unstubAllGlobals());

it("reports an outbox write failure and preserves transactions already stored", () => {
  const entry: OutboxEntry = {
    id: "queued-checkout",
    kind: "checkout",
    client_tx_id: "queued-checkout",
    payment_client_tx_id: "queued-payment",
    idempotency_key: "queued-order",
    order_input: { items: [{ product_id: ES_TEH, qty: 1, modifiers: [] }] },
    order_id: null,
    order_label: "Checkout offline",
    payment: null,
    preview_total: 5000,
    item_count: 1,
    item_summary: "Es Teh Manis",
    created_at: 1,
    status: "queued",
    reject_code: null,
    reject_reason: null,
  };
  let stored = JSON.stringify([entry]);
  const setItem = vi.fn<(key: string, value: string) => void>(() => {
    throw new Error("QuotaExceededError");
  });
  vi.stubGlobal("localStorage", { getItem: () => stored, setItem });

  const newEntry = { ...entry, id: "another-checkout", client_tx_id: "another-checkout" };
  expect(() => addOutboxEntry(newEntry)).toThrow(/gagal disimpan/);
  expect(loadOutbox()).toEqual([entry]);

  setItem.mockImplementation((_key, value) => {
    stored = value;
  });
  addOutboxEntry(newEntry);
  expect(loadOutbox()).toEqual([entry, newEntry]);
});

it("keeps closed shift cash stable while preserving payment retries and pending QRIS", async () => {
  const testDb = createTestDb();
  const { call, login } = makeClient(testDb);
  const token = await login("kasir@demo.seblakpos.id", "seblak123");
  const owner = await login("owner@demo.seblakpos.id", "seblak123");
  const post = <T>(path: string, body: unknown, key?: string, actor = token) =>
    call<T>("POST", `/api/v1${path}`, {
      token: actor,
      body,
      headers: key ? { "Idempotency-Key": key } : undefined,
    });
  const shift = await post<{ id: string }>("/shifts/open", { opening_cash: 100_000 });
  expect(shift.status).toBe(201);
  const createOrder = async (key: string) => {
    const result = await post<{ id: string }>("/orders", {
      items: [{ product_id: ES_TEH, qty: 1, modifiers: [] }],
    }, key);
    expect(result.status).toBe(201);
    return result.json.data.id;
  };
  const pay = (orderId: string, key: string, method: "cash" | "qris" = "cash") =>
    post<{ payment: { id: string; status: string } }>(
      `/orders/${orderId}/payments`, { method, amount: 5000 }, key,
    );

  const cashOrder = await createOrder("shift-cash-order");
  const cash = await pay(cashOrder, "shift-cash-payment");
  expect(cash.status).toBe(201);
  const qrisOrder = await createOrder("shift-qris-order");
  const qris = await pay(qrisOrder, "shift-qris-payment", "qris");
  expect(qris.json.data.payment.status).toBe("pending");
  const unpaidOrder = await createOrder("shift-unpaid-order");

  const shiftPath = `/shifts/${shift.json.data.id}/close`;
  const closed = await post<{ expected_cash: number; difference: number }>(
    shiftPath, { counted_cash: 105_000 },
  );
  expect(closed.status).toBe(200);
  expect(closed.json.data).toMatchObject({ expected_cash: 105_000, difference: 0 });
  expect((await post(shiftPath, { counted_cash: 105_000 })).status).toBe(409);

  const late = await pay(unpaidOrder, "shift-late-payment");
  expect(late.status).toBe(409);
  expect(late.json.error.message).toContain("Shift asal pesanan sudah ditutup");
  expect(testDb.scalar("SELECT COUNT(*) FROM payments WHERE order_id = ?", unpaidOrder)).toBe(0);

  const replay = await pay(cashOrder, "shift-cash-payment");
  expect(replay.json.data.payment.id).toBe(cash.json.data.payment.id);
  const confirmed = await post<{ payment: { status: string } }>(
    `/payments/${qris.json.data.payment.id}/confirm`, {}, undefined, owner,
  );
  expect(confirmed.status).toBe(200);
  expect(confirmed.json.data.payment.status).toBe("settled");

  const report = await call("GET", `/api/v1/reports/shift/${shift.json.data.id}`, { token: owner });
  expect(report.json.data).toMatchObject({
    shift: { expected_cash: 105_000, difference: 0 },
    reconciliation: { expected_cash_computed: 105_000, difference_computed: 0 },
  });
});
