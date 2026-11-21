/**
 * Envelope response Seblak POS — persis kontrak API G1b (docs/g1-kontrak-api-v1.md
 * bagian 2):
 *   sukses : { data, meta: { request_id, server_time [, pagination] } }
 *   error  : { error: { code, message, details }, meta: { request_id } }
 */
import type { ErrorCode } from "./errors";

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
}

export interface SuccessMeta {
  request_id: string;
  server_time: string;
  pagination?: PaginationMeta;
}

export interface SuccessEnvelope<T> {
  data: T;
  meta: SuccessMeta;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  error: ErrorBody;
  meta: { request_id: string };
}

export function successEnvelope<T>(
  data: T,
  requestId: string,
  pagination?: PaginationMeta,
): SuccessEnvelope<T> {
  const meta: SuccessMeta = {
    request_id: requestId,
    server_time: new Date().toISOString(),
  };
  if (pagination !== undefined) {
    meta.pagination = pagination;
  }
  return { data, meta };
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorEnvelope {
  const error: ErrorBody = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { error, meta: { request_id: requestId } };
}
