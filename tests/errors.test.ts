import { describe, expect, it } from "vitest";
import {
  ApiError,
  DEFAULT_ERROR_MESSAGES,
  ERROR_HTTP_STATUS,
  isApiError,
} from "../worker/lib/errors";

describe("pemetaan kode error standar G1b bagian 3", () => {
  it("memetakan semua kode ke status HTTP persis kontrak", () => {
    expect(ERROR_HTTP_STATUS).toEqual({
      VALIDATION_ERROR: 422,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INSUFFICIENT_STOCK: 422,
      SHIFT_NOT_OPEN: 422,
      PAYMENT_MISMATCH: 422,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
    });
  });

  it("setiap kode punya pesan bawaan berbahasa Indonesia", () => {
    for (const code of Object.keys(ERROR_HTTP_STATUS) as Array<
      keyof typeof ERROR_HTTP_STATUS
    >) {
      expect(DEFAULT_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});

describe("ApiError", () => {
  it("membawa code, status, dan pesan bawaan", () => {
    const err = new ApiError("SHIFT_NOT_OPEN");
    expect(err.code).toBe("SHIFT_NOT_OPEN");
    expect(err.status).toBe(422);
    expect(err.message).toBe(DEFAULT_ERROR_MESSAGES.SHIFT_NOT_OPEN);
    expect(err.details).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
  });

  it("pesan dan details khusus menimpa bawaan", () => {
    const err = new ApiError("VALIDATION_ERROR", "Input tidak valid", {
      password: "Kata sandi wajib diisi",
    });
    expect(err.status).toBe(422);
    expect(err.message).toBe("Input tidak valid");
    expect(err.details).toEqual({ password: "Kata sandi wajib diisi" });
  });

  it("isApiError membedakan ApiError dari error biasa", () => {
    expect(isApiError(new ApiError("NOT_FOUND"))).toBe(true);
    expect(isApiError(new Error("boom"))).toBe(false);
    expect(isApiError("bukan error")).toBe(false);
  });
});
