/**
 * Halaman Pesanan: daftar order hari ini dari API dengan status pembayaran
 * & dapur. Detail order (item + pembayaran) dimuat saat baris dibuka; untuk
 * pembayaran non-tunai berstatus pending, owner/manager dapat mengonfirmasi
 * pembayaran dari sini.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  RefreshCw,
  ShoppingBasket,
} from "lucide-react";
import { useAuth } from "../../app/auth";
import {
  confirmPayment,
  getOrderDetail,
  listOrders,
  type Order,
  type OrderDetail,
} from "../../lib/api";
import {
  formatRp,
  formatTime,
  humanError,
  kitchenStatusLabel,
  orderStatusLabel,
  paymentMethodLabel,
  paymentStateLabel,
  paymentStatusLabel,
} from "../../lib/format";

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function PaymentBadge({ status }: { status: string }) {
  const cls =
    status === "paid"
      ? "bg-success-bg text-success"
      : status === "partial"
        ? "bg-warning-bg text-warning"
        : "bg-danger-bg text-danger";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {paymentStatusLabel(status)}
    </span>
  );
}

function KitchenBadge({ status }: { status: string }) {
  const cls =
    status === "done"
      ? "bg-success-bg text-success"
      : status === "cooking"
        ? "bg-warning-bg text-warning"
        : "bg-info-bg text-info";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {kitchenStatusLabel(status)}
    </span>
  );
}

function OrderDetailPanel({
  orderId,
  canConfirm,
  onChanged,
}: {
  orderId: string;
  canConfirm: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getOrderDetail(orderId);
      setDetail(d);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onConfirm = async (paymentId: string) => {
    setBusyPaymentId(paymentId);
    setError(null);
    try {
      await confirmPayment(paymentId);
      await load();
      onChanged();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusyPaymentId(null);
    }
  };

  if (error) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
        <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!detail) return <p className="text-sm text-muted">Memuat detail pesanan…</p>;

  return (
    <div className="grid grid-cols-1 gap-4 break-words md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-semibold text-ink">Item</h4>
        <ul className="space-y-1.5 text-sm">
          {detail.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                <span className="numeric font-semibold">{item.qty}×</span>{" "}
                {item.product_name ?? "Produk"}
                {item.modifiers.length > 0 && (
                  <span className="block text-xs text-muted">
                    {item.modifiers.map((m) => m.name ?? "").filter(Boolean).join(", ")}
                  </span>
                )}
              </span>
              <span className="numeric font-semibold">{formatRp(item.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="numeric mt-3 space-y-1 border-t border-line pt-2 text-sm">
          <div className="flex justify-between"><dt className="text-secondary">Subtotal</dt><dd>{formatRp(detail.subtotal)}</dd></div>
          {detail.discount_total > 0 && (
            <div className="flex justify-between"><dt className="text-secondary">Diskon promo</dt><dd>−{formatRp(detail.discount_total)}</dd></div>
          )}
          {detail.tax_total > 0 && (
            <div className="flex justify-between"><dt className="text-secondary">Pajak</dt><dd>{formatRp(detail.tax_total)}</dd></div>
          )}
          <div className="flex justify-between font-bold"><dt>Total</dt><dd>{formatRp(detail.grand_total)}</dd></div>
          <div className="flex justify-between"><dt className="text-secondary">Sudah terbayar</dt><dd>{formatRp(detail.paid_total)}</dd></div>
        </dl>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-ink">Pembayaran</h4>
        {detail.payments.length === 0 ? (
          <p className="text-sm text-muted">Belum ada pembayaran untuk pesanan ini.</p>
        ) : (
          <ul className="space-y-2">
            {detail.payments.map((p) => (
              <li key={p.id} className="rounded-md border border-line px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {paymentMethodLabel(p.method)} · <span className="numeric">{formatRp(p.amount)}</span>
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      p.status === "settled"
                        ? "bg-success-bg text-success"
                        : p.status === "pending"
                          ? "bg-warning-bg text-warning"
                          : "bg-subtle text-muted"
                    }`}
                  >
                    {paymentStateLabel(p.status)}
                  </span>
                </div>
                {p.change_amount > 0 && (
                  <p className="numeric mt-1 text-xs text-secondary">
                    Kembalian: {formatRp(p.change_amount)}
                  </p>
                )}
                {p.reference_no && (
                  <p className="mt-1 text-xs text-secondary">Referensi: {p.reference_no}</p>
                )}
                {p.status === "pending" && p.method !== "cash" && canConfirm && (
                  <button
                    type="button"
                    disabled={busyPaymentId === p.id}
                    onClick={() => void onConfirm(p.id)}
                    className="mt-2 flex min-h-[44px] items-center gap-2 rounded-md bg-success px-3 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CircleCheck size={16} aria-hidden />
                    {busyPaymentId === p.id ? "Mengonfirmasi…" : "Konfirmasi Pembayaran"}
                  </button>
                )}
                {p.status === "pending" && p.method !== "cash" && !canConfirm && (
                  <p className="mt-1.5 text-xs text-muted">
                    Menunggu konfirmasi dari pemilik/manager.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { user } = useAuth();
  const canConfirm = user?.role === "owner" || user?.role === "manager";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await listOrders({ date_from: startOfToday(), date_to: Date.now() });
      setOrders(page.items);
      setError(null);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-h2 font-bold text-ink">
          Pesanan Hari Ini{" "}
          <span className="numeric text-base font-semibold text-muted">({orders.length})</span>
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
        <p className="text-sm text-muted">Memuat pesanan…</p>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
            <ShoppingBasket size={32} aria-hidden />
          </span>
          <p className="mt-4 font-display text-h2 font-bold text-ink">Belum ada pesanan hari ini</p>
          <p className="mt-1 max-w-sm text-sm text-secondary">
            Pesanan yang dibuat dari kasir pada hari ini akan tampil di sini.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full table-fixed text-sm sm:table-auto">
            <thead>
              <tr className="border-b border-line bg-subtle text-left">
                <th scope="col" className="px-2 py-3 font-semibold text-secondary sm:px-4">No. Order</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold text-secondary sm:table-cell">Waktu</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold text-secondary md:table-cell">Status</th>
                <th scope="col" className="break-words px-2 py-3 font-semibold text-secondary sm:px-4">Pembayaran</th>
                <th scope="col" className="hidden px-4 py-3 font-semibold text-secondary md:table-cell">Dapur</th>
                <th scope="col" className="px-2 py-3 text-right font-semibold text-secondary sm:px-4">Total</th>
                <th scope="col" className="w-[52px] px-1 py-3 sm:w-auto sm:px-4"><span className="sr-only">Detail</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const expanded = expandedId === o.id;
                return [
                  <tr key={o.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="numeric break-words px-2 py-3 font-display font-bold text-ink sm:px-4">{o.order_no}</td>
                    <td className="numeric hidden px-4 py-3 text-secondary sm:table-cell">{formatTime(o.created_at)}</td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {o.status === "void" ? (
                        <span className="inline-flex rounded-full bg-danger-bg px-2.5 py-1 text-xs font-semibold text-danger">
                          Dibatalkan
                        </span>
                      ) : (
                        <span className="text-secondary">{orderStatusLabel(o.status)}</span>
                      )}
                    </td>
                    <td className="px-2 py-3 sm:px-4"><PaymentBadge status={o.payment_status} /></td>
                    <td className="hidden px-4 py-3 md:table-cell"><KitchenBadge status={o.kitchen_status} /></td>
                    <td className="numeric break-words px-2 py-3 text-right font-display font-bold text-ink sm:px-4">{formatRp(o.grand_total)}</td>
                    <td className="px-1 py-3 text-right sm:px-2">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : o.id)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Tutup" : "Lihat"} detail ${o.order_no}`}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-secondary hover:bg-subtle"
                      >
                        <ChevronDown
                          size={20}
                          aria-hidden
                          className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    </td>
                  </tr>,
                  expanded ? (
                    <tr key={`${o.id}-detail`} className="border-b border-line bg-canvas last:border-0">
                      <td colSpan={7} className="px-4 py-4">
                        <OrderDetailPanel orderId={o.id} canConfirm={canConfirm} onChanged={() => void load()} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
