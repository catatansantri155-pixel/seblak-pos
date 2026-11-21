/**
 * Helper format & label Bahasa Indonesia untuk frontend Seblak POS.
 * Uang selalu integer Rupiah; format akhir total transaksi selalu berasal
 * dari respons server — helper ini hanya memformat angka menjadi teks.
 */
import { ApiError, type Role } from "./api";

const rpFormatter = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** 45000 -> "Rp45.000" (pola label harga token Sinta). */
export function formatRp(amount: number): string {
  return `Rp${rpFormatter.format(amount)}`;
}

/** 3000 -> "+Rp3.000" untuk delta harga opsi berbayar. */
export function formatRpDelta(amount: number): string {
  if (amount === 0) return "Gratis";
  const sign = amount > 0 ? "+" : "-";
  return `${sign}Rp${rpFormatter.format(Math.abs(amount))}`;
}

/** Parse input uang dari pengguna: hanya digit yang dipakai. */
export function parseRpInput(raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Format angka saat diketik di input uang (pemisah ribuan). */
export function formatRpInput(amount: number): string {
  if (!amount) return "";
  return rpFormatter.format(amount);
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "owner":
      return "Pemilik";
    case "manager":
      return "Manager";
    case "cashier":
      return "Kasir";
    case "kitchen":
      return "Dapur";
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Lunas";
    case "partial":
      return "Sebagian";
    case "unpaid":
      return "Belum Bayar";
    default:
      return status;
  }
}

export function kitchenStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Antre";
    case "cooking":
      return "Sedang Dimasak";
    case "done":
      return "Selesai Dimasak";
    default:
      return status;
  }
}

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Terbuka";
    case "paid":
      return "Terbayar";
    case "completed":
      return "Selesai";
    case "void":
      return "Dibatalkan";
    default:
      return status;
  }
}

export function orderTypeLabel(type: string): string {
  switch (type) {
    case "dine_in":
      return "Makan di Tempat";
    case "takeaway":
      return "Bawa Pulang";
    case "online":
      return "Online";
    default:
      return type;
  }
}

export function paymentMethodLabel(method: string): string {
  switch (method) {
    case "cash":
      return "Tunai";
    case "qris":
      return "QRIS";
    case "edc":
      return "Kartu (EDC)";
    case "transfer":
      return "Transfer";
    default:
      return method;
  }
}

export function paymentStateLabel(status: string): string {
  switch (status) {
    case "settled":
      return "Terkonfirmasi";
    case "pending":
      return "Menunggu Konfirmasi";
    case "void":
      return "Dibatalkan";
    default:
      return status;
  }
}

export function shiftStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Terbuka";
    case "closed":
      return "Ditutup";
    default:
      return status;
  }
}

export function stockMovementTypeLabel(type: string): string {
  switch (type) {
    case "purchase":
      return "Pembelian";
    case "sale":
      return "Penjualan";
    case "adjustment":
      return "Penyesuaian";
    case "waste":
      return "Terbuang/Rusak";
    case "return":
      return "Retur";
    default:
      return type;
  }
}

export function promotionTypeLabel(type: string): string {
  switch (type) {
    case "percent":
      return "Diskon Persen";
    case "nominal":
      return "Potongan Nominal";
    case "bogo":
      return "Beli X Gratis Y";
    case "free_item":
      return "Item Gratis";
    case "bundle":
      return "Paket (Bundle)";
    default:
      return type;
  }
}

const timeFormatter = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(epochMs: number): string {
  return timeFormatter.format(new Date(epochMs));
}

export function formatDateTime(epochMs: number): string {
  return dateTimeFormatter.format(new Date(epochMs));
}

/** "12 mnt" / "1 j 5 mnt" sejak epochMs — untuk kartu antrean dapur. */
export function formatElapsed(epochMs: number, nowMs: number = Date.now()): string {
  const diffMin = Math.max(0, Math.floor((nowMs - epochMs) / 60000));
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} mnt`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins > 0 ? `${hours} j ${mins} mnt` : `${hours} j`;
}

/** Pesan error manusiawi dari ApiError: utamakan pesan server (sudah Bahasa
 * Indonesia), dengan cadangan per kode kontrak G1b. */
const ERROR_FALLBACK: Record<string, string> = {
  VALIDATION_ERROR: "Ada isian yang belum benar. Periksa kembali formulirnya.",
  UNAUTHORIZED: "Sesi berakhir atau belum login. Silakan masuk lagi.",
  FORBIDDEN: "Peran Anda tidak berhak melakukan aksi ini.",
  NOT_FOUND: "Data tidak ditemukan.",
  CONFLICT: "Data berubah atau bentrok. Muat ulang lalu coba lagi.",
  INSUFFICIENT_STOCK: "Stok bahan tidak cukup untuk pesanan ini.",
  SHIFT_NOT_OPEN: "Shift belum dibuka. Buka shift dulu untuk mulai berjualan.",
  PAYMENT_MISMATCH: "Jumlah pembayaran tidak sesuai dengan sisa tagihan.",
  RATE_LIMITED: "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
  INTERNAL_ERROR: "Terjadi kesalahan pada server. Coba lagi nanti.",
  NETWORK_ERROR: "Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.",
};

export function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message && err.code !== "INTERNAL_ERROR") return err.message;
    return ERROR_FALLBACK[err.code] ?? err.message;
  }
  return "Terjadi kesalahan yang tidak diketahui.";
}

/** Ambil pesan per-field dari details envelope (mis. { email: "..." }). */
export function fieldError(err: unknown, field: string): string | null {
  if (err instanceof ApiError && err.details && typeof err.details === "object") {
    const value = (err.details as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return null;
}
