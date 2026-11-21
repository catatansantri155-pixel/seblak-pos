/**
 * Seblak POS — entrypoint Cloudflare Worker (Hono).
 *
 * Cakupan sampai G3a (backend inti):
 * - middleware request_id untuk semua response (dipakai envelope G1b),
 * - error handler global: ApiError -> envelope error kode G1b; error tak
 *   dikenal -> INTERNAL_ERROR 500 tanpa rincian internal,
 * - GET /api/v1/health (publik),
 * - auth nyata: POST /api/v1/auth/login (publik), logout & me (terproteksi),
 * - rute terproteksi (middleware sesi) di /api/v1: master data (categories,
 *   products, variants, modifiers), shifts, orders, payments, kitchen,
 * - G4a (backend operasi): reports (owner/manager), stock, sync offline,
 *   users, outlets, promotions CRUD + kode promo (migrasi 0009),
 * - path /api/v1/* lain -> 404 envelope NOT_FOUND (tidak ada endpoint palsu).
 *
 * Modul kontrak G1b yang BELUM dibangun (menyusul per gate):
 * purchase-orders & stock_batches.
 */
import { Hono } from "hono";
import { ApiError } from "./lib/errors";
import { errorEnvelope, successEnvelope } from "./lib/envelope";
import { authMiddleware } from "./lib/auth";
import type { Env, Variables } from "./lib/types";
import authRoutes from "./routes/auth";
import masterRoutes from "./routes/master";
import shiftRoutes from "./routes/shifts";
import orderRoutes from "./routes/orders";
import paymentRoutes from "./routes/payments";
import kitchenRoutes from "./routes/kitchen";
import reportRoutes from "./routes/reports";
import stockRoutes from "./routes/stock";
import syncRoutes from "./routes/sync";
import userRoutes from "./routes/users";
import outletRoutes from "./routes/outlets";
import promotionRoutes from "./routes/promotions";

export type { Env };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- request_id middleware -------------------------------------------------
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});

// --- health (publik) ---------------------------------------------------------
app.get("/api/v1/health", (c) => {
  return c.json(
    successEnvelope({ status: "ok" }, c.get("requestId")),
    200,
  );
});

// --- auth (login publik; logout & me memasang middleware di dalam router) ----
app.route("/api/v1", authRoutes);

// --- rute terproteksi: semua wajib sesi sah ----------------------------------
const protectedApi = new Hono<{ Bindings: Env; Variables: Variables }>();
protectedApi.use("*", authMiddleware);
protectedApi.route("/", masterRoutes);
protectedApi.route("/", shiftRoutes);
protectedApi.route("/", orderRoutes);
protectedApi.route("/", paymentRoutes);
protectedApi.route("/", kitchenRoutes);
protectedApi.route("/", reportRoutes);
protectedApi.route("/", stockRoutes);
protectedApi.route("/", syncRoutes);
protectedApi.route("/", userRoutes);
protectedApi.route("/", outletRoutes);
protectedApi.route("/", promotionRoutes);
app.route("/api/v1", protectedApi);

// --- 404 untuk path API yang belum ada ----------------------------------------
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
