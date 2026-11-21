/**
 * Outbox offline kasir — antrean checkout yang gagal terkirim karena
 * jaringan (bukan karena ditolak server), disimpan di localStorage.
 *
 * Kejujuran status adalah aturan utama modul ini: entri outbox adalah
 * catatan DI PERANGKAT. Order baru dianggap masuk server setelah
 * POST /sync/push menjawab accepted/duplicate untuk event-nya.
 *
 * Setiap entri checkout membawa client_tx_id unik (idempotensi G1b):
 * pengiriman ulang tidak akan menggandakan order di server. Hasil per
 * event dari server:
 * - accepted/duplicate -> entri selesai, dihapus dari antrean.
 * - rejected           -> entri DITANDAI dengan alasan server dan tetap
 *   tampil di kasir (lencana Ditolak) sampai kasir menghapusnya manual
 *   atau mengirim ulang lewat tombol Sinkronkan Sekarang.
 */
import {
  isApiError,
  syncPull,
  syncPush,
  type CreateOrderInput,
  type PaymentMethod,
  type SyncEventInput,
  type SyncEventResult,
} from "./api";

export interface OutboxPayment {
  method: PaymentMethod;
  amount: number;
  reference_no: string | null;
}

export interface OutboxEntry {
  /** ID lokal entri (= client_tx_id order untuk checkout). */
  id: string;
  kind: "checkout" | "payment";
  /** client_tx_id order (checkout); untuk kind "payment": client_tx_id
   * order rujukan bila dikenal, string kosong bila tidak. */
  client_tx_id: string;
  payment_client_tx_id: string;
  /** Idempotency-Key yang dipakai percobaan online (jejak audit lokal). */
  idempotency_key: string | null;
  /** Isi order persis seperti yang gagal terkirim (checkout saja). */
  order_input: CreateOrderInput | null;
  /** Order yang sudah ada di server (kind "payment" saja). */
  order_id: string | null;
  order_label: string;
  payment: OutboxPayment | null;
  /** Total pratinjau lokal saat checkout (bukan angka resmi server). */
  preview_total: number;
  item_count: number;
  item_summary: string;
  created_at: number;
  status: "queued" | "rejected";
  reject_code: string | null;
  reject_reason: string | null;
}

const STORAGE_KEY = "seblakpos.outbox.v1";
export const OUTBOX_CHANGED_EVENT = "seblakpos:outbox-changed";

function notifyChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT));
  } catch {
    // Bukan di browser (SSR/test): abaikan.
  }
}

export function loadOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is OutboxEntry =>
        typeof e === "object" && e !== null && "id" in e && "status" in e,
    );
  } catch {
    return [];
  }
}

function saveOutbox(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Penyimpanan penuh/tidak tersedia: antrean hanya hidup di memori sesi.
  }
  notifyChanged();
}

/** Jumlah checkout yang belum terkirim (untuk lencana header). */
export function outboxQueuedCount(): number {
  return loadOutbox().filter((e) => e.status === "queued").length;
}

export function addOutboxEntry(entry: OutboxEntry): void {
  const entries = loadOutbox();
  entries.push(entry);
  saveOutbox(entries);
}

export function removeOutboxEntry(id: string): void {
  saveOutbox(loadOutbox().filter((e) => e.id !== id));
}

/** Langganan perubahan antrean (event lokal + perubahan tab lain). */
export function subscribeOutbox(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(OUTBOX_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(OUTBOX_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export interface SyncSummary {
  attempted: number;
  completed: number;
  rejected: number;
  remaining: number;
  /** true bila pengiriman itu sendiri gagal jaringan (antrean utuh). */
  networkError: boolean;
}

interface EntryEvents {
  entry: OutboxEntry;
  orderEventId: string | null;
  paymentEventId: string | null;
}

function buildEvents(entries: OutboxEntry[]): {
  events: SyncEventInput[];
  map: EntryEvents[];
} {
  const events: SyncEventInput[] = [];
  const map: EntryEvents[] = [];
  for (const entry of entries) {
    const item: EntryEvents = { entry, orderEventId: null, paymentEventId: null };
    if (entry.kind === "checkout" && entry.order_input) {
      item.orderEventId = entry.client_tx_id;
      events.push({
        client_tx_id: entry.client_tx_id,
        entity: "order",
        payload: { ...entry.order_input },
      });
      if (entry.payment) {
        item.paymentEventId = entry.payment_client_tx_id;
        events.push({
          client_tx_id: entry.payment_client_tx_id,
          entity: "payment",
          payload: {
            order_client_tx_id: entry.client_tx_id,
            method: entry.payment.method,
            amount: entry.payment.amount,
            reference_no: entry.payment.reference_no,
          },
        });
      }
    } else if (entry.kind === "payment" && entry.payment && entry.order_id) {
      item.paymentEventId = entry.payment_client_tx_id;
      events.push({
        client_tx_id: entry.payment_client_tx_id,
        entity: "payment",
        payload: {
          order_id: entry.order_id,
          method: entry.payment.method,
          amount: entry.payment.amount,
          reference_no: entry.payment.reference_no,
        },
      });
    }
    map.push(item);
  }
  return { events, map };
}

/**
 * Kirim antrean ke POST /sync/push. Entri berstatus "rejected" hanya ikut
 * bila includeRejected true (tombol manual kasir); sinkronisasi otomatis
 * (event online / halaman dibuka) hanya mengirim yang "queued" agar
 * penolakan permanen tidak berputar tanpa keputusan kasir.
 */
export async function syncOutbox(
  options?: { includeRejected?: boolean },
): Promise<SyncSummary> {
  const all = loadOutbox();
  const targets = all.filter(
    (e) => e.status === "queued" || (options?.includeRejected && e.status === "rejected"),
  );
  if (targets.length === 0) {
    return { attempted: 0, completed: 0, rejected: 0, remaining: all.length, networkError: false };
  }

  const { events, map } = buildEvents(targets);
  const results = new Map<string, SyncEventResult>();
  try {
    // /sync/push membatasi 100 event per panggilan: kirim per potongan.
    for (let i = 0; i < events.length; i += 100) {
      const chunk = events.slice(i, i + 100);
      const res = await syncPush(chunk);
      for (const r of res.results) results.set(r.client_tx_id, r);
    }
  } catch (err) {
    if (isApiError(err) && err.code === "NETWORK_ERROR") {
      return {
        attempted: targets.length,
        completed: 0,
        rejected: 0,
        remaining: all.length,
        networkError: true,
      };
    }
    throw err;
  }

  const kept: OutboxEntry[] = [];
  let completed = 0;
  let rejectedCount = 0;

  for (const { entry, orderEventId, paymentEventId } of map) {
    const orderResult = orderEventId ? results.get(orderEventId) : undefined;
    const paymentResult = paymentEventId ? results.get(paymentEventId) : undefined;

    let orderRejected = orderResult?.status === "rejected" ? orderResult : undefined;

    // Pemulihan khusus: order ditolak CONFLICT karena client_tx_id sudah
    // dipakai — itu terjadi bila percobaan online sebenarnya sempat
    // diproses server tetapi responsnya hilang di jaringan. Periksa lewat
    // /sync/pull apakah order-nya memang sudah ada; bila ada, perlakukan
    // sebagai duplicate (bukan penolakan).
    if (orderRejected && orderRejected.error?.code === "CONFLICT") {
      try {
        const pulled = await syncPull(Math.max(0, entry.created_at - 5 * 60_000));
        const found = pulled.orders.find((o) => o.client_tx_id === entry.client_tx_id);
        if (found) orderRejected = undefined;
      } catch {
        // Pull gagal: biarkan verdict penolakan apa adanya.
      }
    }

    const paymentRejected =
      paymentResult?.status === "rejected" ? paymentResult : undefined;

    if (!orderRejected && !paymentRejected) {
      completed += 1;
      continue; // selesai: tidak disimpan lagi
    }

    const culprit = orderRejected ?? paymentRejected;
    kept.push({
      ...entry,
      status: "rejected",
      reject_code: culprit?.error?.code ?? "INTERNAL_ERROR",
      reject_reason: culprit?.error?.message ?? "Ditolak server tanpa alasan tertulis.",
    });
    rejectedCount += 1;
  }

  const targetIds = new Set(targets.map((e) => e.id));
  const untouched = all.filter((e) => !targetIds.has(e.id));
  const next = [...untouched, ...kept].sort((a, b) => a.created_at - b.created_at);
  saveOutbox(next);

  return {
    attempted: targets.length,
    completed,
    rejected: rejectedCount,
    remaining: next.length,
    networkError: false,
  };
}
