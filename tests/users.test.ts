/**
 * Test manajemen pengguna & outlet (G4a) terhadap Worker + shim D1:
 * - owner membuat kasir baru; kasir baru bisa login.
 * - email dobel di outlet yang sama -> CONFLICT.
 * - membuat pengguna oleh manager -> FORBIDDEN (hanya owner).
 * - daftar pengguna untuk manager tidak memuat password_hash.
 * - reset password oleh owner mencabut sesi lama (token lama 401,
 *   kata sandi lama ditolak, kata sandi baru diterima).
 * - menonaktifkan pengguna mencabut akses (token aktif 401, login ditolak).
 * - GET /outlets/me mengembalikan nama outlet; PATCH oleh owner mengubah
 *   nama; PATCH oleh kasir -> FORBIDDEN.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/d1";
import { makeClient } from "./helpers/api";

let t: TestDb;
let client: ReturnType<typeof makeClient>;
let call: ReturnType<typeof makeClient>["call"];
let ownerToken = "";
let managerToken = "";
let newUserId = "";
let newUserToken = "";

beforeAll(async () => {
  t = createTestDb(true);
  client = makeClient(t);
  call = client.call;
  ownerToken = await client.login("owner@demo.seblakpos.id", "seblak123");
  managerToken = await client.login("admin@demo.seblakpos.id", "seblak123");
});

describe("users", () => {
  it("owner membuat kasir baru; kasir baru bisa login", async () => {
    const r = await call<{ id: string; role: string }>("POST", "/api/v1/users", {
      token: ownerToken,
      body: {
        name: "Kasir Dua", email: "kasir2@demo.seblakpos.id",
        password: "rahasia123", role: "cashier",
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.data.role).toBe("cashier");
    newUserId = r.json.data.id;

    newUserToken = await client.login("kasir2@demo.seblakpos.id", "rahasia123");
    const me = await call<{ email: string }>("GET", "/api/v1/auth/me", {
      token: newUserToken,
    });
    expect(me.json.data.email).toBe("kasir2@demo.seblakpos.id");
  });

  it("email dobel -> 409 CONFLICT; manager membuat user -> 403", async () => {
    const dup = await call("POST", "/api/v1/users", {
      token: ownerToken,
      body: {
        name: "Tiru", email: "kasir2@demo.seblakpos.id",
        password: "rahasia123", role: "cashier",
      },
    });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("CONFLICT");

    const byManager = await call("POST", "/api/v1/users", {
      token: managerToken,
      body: {
        name: "Dari Manager", email: "mgr@demo.seblakpos.id",
        password: "rahasia123", role: "cashier",
      },
    });
    expect(byManager.status).toBe(403);
    expect(byManager.json.error.code).toBe("FORBIDDEN");
  });

  it("daftar pengguna untuk manager tanpa password_hash", async () => {
    const r = await call<Record<string, unknown>[]>("GET", "/api/v1/users", {
      token: managerToken,
    });
    expect(r.status).toBe(200);
    expect(r.json.data.some((u) => u["id"] === newUserId)).toBe(true);
    for (const u of r.json.data) {
      expect(u).not.toHaveProperty("password_hash");
    }
  });

  it("reset password mencabut sesi & kata sandi lama", async () => {
    const r = await call("POST", `/api/v1/users/${newUserId}/reset-password`, {
      token: ownerToken, body: { password: "baru12345" },
    });
    expect(r.status).toBe(200);

    const oldToken = await call("GET", "/api/v1/auth/me", { token: newUserToken });
    expect(oldToken.status).toBe(401);

    const oldLogin = await call("POST", "/api/v1/auth/login", {
      body: { email: "kasir2@demo.seblakpos.id", password: "rahasia123" },
    });
    expect(oldLogin.status).toBe(401);

    newUserToken = await client.login("kasir2@demo.seblakpos.id", "baru12345");
  });

  it("menonaktifkan pengguna mencabut akses sepenuhnya", async () => {
    const r = await call<{ is_active: boolean }>(
      "PATCH", `/api/v1/users/${newUserId}`,
      { token: ownerToken, body: { is_active: false } },
    );
    expect(r.status).toBe(200);
    expect(r.json.data.is_active).toBe(false);

    const me = await call("GET", "/api/v1/auth/me", { token: newUserToken });
    expect(me.status).toBe(401);

    const login = await call("POST", "/api/v1/auth/login", {
      body: { email: "kasir2@demo.seblakpos.id", password: "baru12345" },
    });
    expect(login.status).toBe(401);
  });
});

describe("outlets/me", () => {
  it("GET mengembalikan profil outlet demo; PATCH owner mengubah nama", async () => {
    const before = await call<{ name: string; tax_rate_bp: number }>(
      "GET", "/api/v1/outlets/me", { token: ownerToken },
    );
    expect(before.status).toBe(200);
    expect(before.json.data.name).toBe("Seblak Demo Nusantara");

    const patched = await call<{ name: string; phone: string | null }>(
      "PATCH", "/api/v1/outlets/me",
      { token: ownerToken, body: { name: "Seblak Demo Baru", phone: "081299999999" } },
    );
    expect(patched.status).toBe(200);
    expect(patched.json.data.name).toBe("Seblak Demo Baru");
    expect(patched.json.data.phone).toBe("081299999999");

    const kasir = await client.login("kasir@demo.seblakpos.id", "seblak123");
    const forbidden = await call("PATCH", "/api/v1/outlets/me", {
      token: kasir, body: { name: "Tidak Boleh" },
    });
    expect(forbidden.status).toBe(403);
  });
});
