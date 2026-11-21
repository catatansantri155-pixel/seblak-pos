import { describe, expect, it } from "vitest";
import { errorEnvelope, successEnvelope } from "../worker/lib/envelope";

describe("successEnvelope (G1b bagian 2)", () => {
  it("membentuk { data, meta: { request_id, server_time } }", () => {
    const env = successEnvelope({ status: "ok" }, "req-123");
    expect(env.data).toEqual({ status: "ok" });
    expect(env.meta.request_id).toBe("req-123");
    expect(typeof env.meta.server_time).toBe("string");
    expect(() => new Date(env.meta.server_time).toISOString()).not.toThrow();
    expect(env.meta.server_time).toBe(
      new Date(env.meta.server_time).toISOString(),
    );
    expect(env.meta.pagination).toBeUndefined();
    expect(Object.keys(env).sort()).toEqual(["data", "meta"]);
  });

  it("menambahkan meta.pagination hanya untuk daftar", () => {
    const env = successEnvelope([1, 2], "req-9", {
      page: 1,
      per_page: 20,
      total: 137,
    });
    expect(env.meta.pagination).toEqual({ page: 1, per_page: 20, total: 137 });
  });
});

describe("errorEnvelope (G1b bagian 2)", () => {
  it("membentuk { error: { code, message, details }, meta: { request_id } }", () => {
    const env = errorEnvelope("VALIDATION_ERROR", "Input tidak valid", "req-1", {
      email: "Format email tidak valid",
    });
    expect(env.error.code).toBe("VALIDATION_ERROR");
    expect(env.error.message).toBe("Input tidak valid");
    expect(env.error.details).toEqual({
      email: "Format email tidak valid",
    });
    expect(env.meta).toEqual({ request_id: "req-1" });
    expect("data" in env).toBe(false);
  });

  it("menghilangkan details bila tidak diberikan", () => {
    const env = errorEnvelope("NOT_FOUND", "Data tidak ditemukan", "req-2");
    expect(env.error.details).toBeUndefined();
    expect(Object.keys(env.error).sort()).toEqual(["code", "message"]);
  });
});
