/**
 * Klien test bersama untuk test integrasi G4+: memanggil Worker Hono
 * langsung (app.request) dengan binding DB dari shim (tests/helpers/d1.ts),
 * meniru pola tests/orders.test.ts.
 */
import { expect } from "vitest";
import app from "../../worker/index";
import type { TestDb } from "./d1";

export interface Envelope<T> {
  data: T;
  meta: { request_id: string; pagination?: { page: number; per_page: number; total: number } };
}
export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export interface CallResult<T> {
  status: number;
  json: Envelope<T> & ErrorEnvelope;
}

export function makeClient(t: TestDb) {
  async function call<T>(
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<CallResult<T>> {
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

  return { call, login };
}

/** Item contoh kontrak: 1 porsi = 10000 + bakso 2x2000 + ceker 3000 + telur 4000 = 21000. */
export const SEBLAK = "d0000000-0000-4000-8000-000000000001";
export const ES_TEH = "d0000000-0000-4000-8000-000000000002";
export const STOK_BAKSO = "d0000000-0000-4000-8000-000000000011";
export const STOK_CEKER = "d0000000-0000-4000-8000-000000000012";
export const STOK_TELUR = "d0000000-0000-4000-8000-000000000013";
export const OPT_LEVEL1 = "f0000000-0000-4000-8000-000000000002";
export const OPT_BAKSO = "f0000000-0000-4000-8000-000000000011";
export const OPT_CEKER = "f0000000-0000-4000-8000-000000000012";
export const OPT_TELUR = "f0000000-0000-4000-8000-000000000013";
export const CAT_SEBLAK = "c0000000-0000-4000-8000-000000000001";
export const CAT_MINUMAN = "c0000000-0000-4000-8000-000000000002";

export const kontrakItems = (qty: number) => [
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
