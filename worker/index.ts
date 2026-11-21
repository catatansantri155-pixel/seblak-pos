/**
 * Seblak POS — entrypoint Cloudflare Worker (Hono).
 *
 * Cakupan bagian G2 ini (fondasi):
 * - middleware request_id untuk semua response (dipakai envelope G1b),
 * - error handler global: ApiError -> envelope error dengan kode & status G1b;
 *   error tak dikenal -> INTERNAL_ERROR 500 tanpa rincian internal,
 * - GET  /api/v1/health      -> { data: { status: "ok" } },
 * - POST /api/v1/auth/login  -> kerangka nyata: validasi zod (email + password),
 *   input tidak valid -> VALIDATION_ERROR dengan details per field,
 *   kredensial berbentuk sah -> UNAUTHORIZED (lihat catatan di handler),
 * - path /api/v1/* lain yang belum ada -> 404 envelope NOT_FOUND.
 *
 * Endpoint modul lain di kontrak G1b (products, orders, payments, shifts,
 * inventory, promotions, reports, sync) BELUM diimplementasikan di bagian ini
 * dan sengaja tidak dibuatkan endpoint palsu; mereka menyusul per gate.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "./lib/errors";
import { errorEnvelope, successEnvelope } from "./lib/envelope";

export interface Env {
  DB: D1Database;
}

interface Variables {
  requestId: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- request_id middleware -------------------------------------------------
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});

// --- health ------------------------------------------------------------------
app.get("/api/v1/health", (c) => {
  return c.json(
    successEnvelope({ status: "ok" }, c.get("requestId")),
    200,
  );
});

// --- auth (kerangka) -----------------------------------------------------------
const loginSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});

app.post("/api/v1/auth/login", async (c) => {
  let raw: unknown = null;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "_body";
      if (!(field in details)) {
        details[field] = issue.message;
      }
    }
    throw new ApiError("VALIDATION_ERROR", "Input tidak valid", details);
  }

  // CATATAN JUJUR (G2 fondasi): verifikasi kredensial ke tabel `users`
  // (pencocokan password_hash) dan penerbitan token sesi BELUM dikerjakan di
  // bagian ini — tabel sesi belum menjadi bagian fondasi G2 ini. Karena itu
  // setiap kredensial yang bentuknya sah untuk sementara selalu dijawab
  // UNAUTHORIZED, sesuai kontrak G1b untuk kredensial yang tidak terverifikasi.
  // Implementasi verifikasi menyusul di bagian G2 berikutnya.
  throw new ApiError("UNAUTHORIZED", "Email atau kata sandi tidak valid");
});

// --- 404 untuk path API yang belum ada -----------------------------------------
app.notFound((c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  return c.json(
    errorEnvelope("NOT_FOUND", "Data tidak ditemukan", requestId),
    404,
  );
});

// --- error handler global --------------------------------------------------------
app.onError((err, c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  if (err instanceof ApiError) {
    return c.json(
      errorEnvelope(err.code, err.message, requestId, err.details),
      err.status as 422,
    );
  }
  // Error tak dikenal: jangan bocorkan rincian internal (kontrak G1b).
  console.error("INTERNAL_ERROR", requestId, err);
  return c.json(
    errorEnvelope("INTERNAL_ERROR", "Kesalahan internal server", requestId),
    500,
  );
});

export default app;
