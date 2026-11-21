/**
 * Helper validasi zod -> ApiError VALIDATION_ERROR dengan details per-field,
 * mengikuti pola envelope kontrak G1b.
 */
import type { ZodTypeAny, infer as ZodInfer } from "zod";
import { ApiError } from "./errors";

export function zodDetails(error: {
  issues: { path: (string | number)[]; message: string }[];
}): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "_body";
    if (!(field in details)) details[field] = issue.message;
  }
  return details;
}

export function parseWith<S extends ZodTypeAny>(
  schema: S,
  raw: unknown,
): ZodInfer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "Input tidak valid", zodDetails(parsed.error));
  }
  return parsed.data;
}

/** Baca body JSON; body kosong/rusak diperlakukan sebagai {} agar zod yang menilai. */
export async function readJsonBody(req: {
  json: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** Pagination kontrak G1b: page mulai 1, per_page default 20 maks 100. */
export function parsePagination(query: Record<string, string | undefined>): {
  page: number;
  perPage: number;
  limit: number;
  offset: number;
} {
  const pageRaw = Number(query.page ?? "1");
  const perPageRaw = Number(query.per_page ?? query.limit ?? "20");
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const perPage =
    Number.isInteger(perPageRaw) && perPageRaw >= 1
      ? Math.min(perPageRaw, 100)
      : 20;
  return { page, perPage, limit: perPage, offset: (page - 1) * perPage };
}
