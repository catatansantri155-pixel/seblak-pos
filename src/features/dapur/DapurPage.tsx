/**
 * Layar Dapur: antrean order dari API (kitchen/queue), dikelompokkan Antre
 * dan Sedang Dimasak. Transisi sah: queued -> cooking -> done. Data
 * disegarkan otomatis tiap 10 detik + tombol Segarkan manual.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  CircleAlert,
  CircleCheck,
  CookingPot,
  RefreshCw,
  ShoppingBasket,
} from "lucide-react";
import {
  isApiError,
  kitchenQueue,
  kitchenSetStatus,
  type KitchenOrder,
} from "../../lib/api";
import {
  formatElapsed,
  formatTime,
  humanError,
  kitchenStatusLabel,
  orderTypeLabel,
  paymentStatusLabel,
} from "../../lib/format";

function KitchenCard({
  order,
  busy,
  onAdvance,
}: {
  order: KitchenOrder;
  busy: boolean;
  onAdvance: (order: KitchenOrder) => void;
}) {
  const isQueued = order.kitchen_status === "queued";
  return (
    <article className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="numeric font-display text-h2 font-bold text-ink">{order.order_no}</p>
          <p className="text-xs text-muted">
            {formatTime(order.created_at)} · {formatElapsed(order.created_at)} yang lalu ·{" "}
            {orderTypeLabel(order.type)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            isQueued ? "bg-info-bg text-info" : "bg-warning-bg text-warning"
          }`}
        >
          {isQueued ? <Bell size={14} aria-hidden /> : <CookingPot size={14} aria-hidden />}
          {kitchenStatusLabel(order.kitchen_status)}
        </span>
      </header>

      <p className="mt-1 text-xs font-medium text-secondary">
        Pembayaran: {paymentStatusLabel(order.payment_status)}
      </p>

      <ul className="mt-3 space-y-2 border-t border-line pt-3">
        {order.items.map((item) => (
          <li key={item.id} className="text-sm">
            <span className="numeric font-display font-bold text-ink">{item.qty}×</span>{" "}
            <span className="font-semibold text-ink">{item.product_name ?? "Produk"}</span>
            {item.modifiers.length > 0 && (
              <span className="block pl-6 text-secondary">
                {item.modifiers.map((m) => m.name ?? "").filter(Boolean).join(", ")}
              </span>
            )}
            {item.note && (
              <span className="block pl-6 italic text-muted">Catatan: {item.note}</span>
            )}
          </li>
        ))}
      </ul>

      {order.note && (
        <p className="mt-2 rounded-md bg-subtle px-2.5 py-1.5 text-xs italic text-secondary">
          Catatan pesanan: {order.note}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => onAdvance(order)}
        className={`mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md font-display text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
          isQueued ? "bg-primary hover:bg-primary-hover" : "bg-success hover:opacity-90"
        }`}
      >
        {isQueued ? (
          <>
            <CookingPot size={20} aria-hidden /> Mulai Masak
          </>
        ) : (
          <>
            <CircleCheck size={20} aria-hidden /> Selesai
          </>
        )}
      </button>
    </article>
  );
}

export default function DapurPage() {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const loadingRef = useRef(false);

  const load = useCallback(async (initial = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (initial) setLoading(true);
    try {
      const data = await kitchenQueue();
      setOrders(data);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    } finally {
      loadingRef.current = false;
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const poll = setInterval(() => void load(), 10_000);
    const tick = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const onAdvance = async (order: KitchenOrder) => {
    const next = order.kitchen_status === "queued" ? "cooking" : "done";
    setBusyId(order.id);
    setError(null);
    try {
      await kitchenSetStatus(order.id, next);
      await load();
    } catch (err) {
      // Kemungkinan data sudah berubah (CONFLICT): segarkan antrean.
      setError(humanError(err));
      if (isApiError(err) && err.code === "CONFLICT") await load();
    } finally {
      setBusyId(null);
    }
  };

  const queued = orders.filter((o) => o.kitchen_status === "queued");
  const cooking = orders.filter((o) => o.kitchen_status === "cooking");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-h2 font-bold text-ink">
          Antrean Dapur{" "}
          <span className="numeric text-base font-semibold text-muted">
            ({orders.length} pesanan aktif)
          </span>
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          className="flex min-h-[44px] items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-secondary hover:bg-subtle"
        >
          <RefreshCw size={16} aria-hidden />
          Segarkan
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Memuat antrean dapur…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
            <ShoppingBasket size={32} aria-hidden />
          </span>
          <p className="mt-4 font-display text-h2 font-bold text-ink">Tidak ada antrean dapur</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            Pesanan baru yang masuk dari kasir akan tampil di sini secara otomatis.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Antre">
            <h3 className="mb-3 flex items-center gap-2 font-display text-h3 font-semibold text-info">
              <BellRing size={18} aria-hidden /> Antre ({queued.length})
            </h3>
            <div className="flex flex-col gap-3">
              {queued.map((o) => (
                <KitchenCard key={o.id} order={o} busy={busyId === o.id} onAdvance={onAdvance} />
              ))}
              {queued.length === 0 && <p className="text-sm text-muted">Tidak ada pesanan antre.</p>}
            </div>
          </section>
          <section aria-label="Sedang dimasak">
            <h3 className="mb-3 flex items-center gap-2 font-display text-h3 font-semibold text-warning">
              <CookingPot size={18} aria-hidden /> Sedang Dimasak ({cooking.length})
            </h3>
            <div className="flex flex-col gap-3">
              {cooking.map((o) => (
                <KitchenCard key={o.id} order={o} busy={busyId === o.id} onAdvance={onAdvance} />
              ))}
              {cooking.length === 0 && (
                <p className="text-sm text-muted">Belum ada pesanan yang sedang dimasak.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
