/**
 * Kode error standar Seblak POS — persis kontrak API G1b (docs/g1-kontrak-api-v1.md
 * bagian 3). Jangan menambah/mengubah kode di sini tanpa mengubah kontrak.
 */
export const ERROR_HTTP_STATUS = {
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
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Input tidak valid",
  UNAUTHORIZED: "Belum login atau token tidak sah",
  FORBIDDEN: "Peran tidak berhak melakukan aksi ini",
  NOT_FOUND: "Data tidak ditemukan",
  CONFLICT: "Konflik data (version atau duplikat)",
  INSUFFICIENT_STOCK: "Stok tidak cukup untuk penjualan",
  SHIFT_NOT_OPEN: "Kasir belum membuka shift",
  PAYMENT_MISMATCH: "Total alokasi pembayaran tidak sama dengan jumlah pembayaran",
  RATE_LIMITED: "Terlalu banyak permintaan",
  INTERNAL_ERROR: "Kesalahan internal server",
};

/**
 * Error aplikasi yang membawa kode kontrak G1b. Dilempar dari handler mana pun;
 * error handler global di worker/index.ts mengubahnya menjadi envelope error.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code]);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
