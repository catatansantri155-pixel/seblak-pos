/**
 * Tipe bersama Worker Seblak POS: bindings Cloudflare + variabel konteks Hono.
 */

export interface Env {
  DB: D1Database;
}

export type Role = "owner" | "manager" | "cashier" | "kitchen";

/** Konteks pengguna terautentikasi yang dipasang middleware auth. */
export interface AuthUser {
  id: string;
  outlet_id: string;
  role: Role;
  name: string;
  email: string;
  session_id: string;
}

export interface Variables {
  requestId: string;
  user: AuthUser;
}
