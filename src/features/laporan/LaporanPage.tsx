/**
 * Halaman Laporan — angka mengikuti Metric Dictionary Lestari (G4a):
 * hanya transaksi LUNAS yang menjadi pendapatan; pembayaran pending
 * dilaporkan terpisah dan tidak masuk penerimaan. Semua angka di halaman
 * ini berasal dari respons server (/reports/*), tidak dihitung lokal.
 */
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, ReceiptText, X } from "lucide-react";
import {
  categoryReport,
  dailyReport,
  productReport,
  shiftReport,
  type CategoryReportItem,
  type DailyReport,
  type ProductReportItem,
  type ShiftReport,
} from "../../lib/api";
import {
  formatDateTime,
  formatRp,
  formatTime,
  humanError,
  paymentMethodLabel,
  shiftStatusLabel,
} from "../../lib/format";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-secondary">{label}</p>
      <p
        className={`numeric mt-1 font-display text-price-lg font-extrabold ${
          accent ? "text-primary-text" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function LaporanPage() {
  const [date, setDate] = useState(todayLocal());
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [products, setProducts] = useState<ProductReportItem[]>([]);
  const [categories, setCategories] = useState<CategoryReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [shiftDetail, setShiftDetail] = useState<ShiftReport | null>(null);
  const [shiftLoadingId, setShiftLoadingId] = useState<string | null>(null);
  const [shiftError, setShiftError] = useState<string | null>(null);

  const load = useCallback(async (forDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const [d, p, c] = await Promise.all([
        dailyReport(forDate),
        productReport(forDate, forDate),
        categoryReport(forDate, forDate),
      ]);
      setDaily(d);
      setProducts(p.items);
      setCategories(c.items);
    } catch (err) {
      setError(humanError(err));
      setDaily(null);
      setProducts([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [load, date]);

  const openShiftDetail = async (id: string) => {
    setShiftLoadingId(id);
    setShiftError(null);
    try {
      const detail = await shiftReport(id);
      setShiftDetail(detail);
    } catch (err) {
      setShiftError(humanError(err));
    } finally {
      setShiftLoadingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="report-date" className="mb-1.5 block text-sm font-semibold text-ink">
            Tanggal laporan
          </label>
          <input
            id="report-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[48px] rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => setDate(todayLocal())}
          className="min-h-[48px] rounded-md border border-line px-4 text-sm font-semibold text-primary-text hover:bg-subtle"
        >
          Hari Ini
        </button>
        <button
          type="button"
          onClick={() => void load(date)}
          disabled={loading}
          className="min-h-[48px] rounded-md bg-primary px-4 text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Memuat…" : "Muat Ulang"}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Belum bisa memuat laporan: {error}</span>
        </div>
      )}
      {shiftError && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Belum bisa memuat rekonsiliasi shift: {shiftError}</span>
        </div>
      )}

      {loading && !daily ? (
        <p className="mt-8 text-sm text-muted">Memuat laporan…</p>
      ) : daily ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <SummaryCard label="Penjualan Kotor" value={formatRp(daily.gross_sales)} />
            <SummaryCard label="Diskon" value={formatRp(daily.discount_total)} />
            <SummaryCard label="Penjualan Bersih" value={formatRp(daily.net_sales)} accent />
            <SummaryCard
              label="Transaksi Lunas"
              value={String(daily.paid_transaction_count)}
            />
            <SummaryCard
              label="Rata-rata Transaksi"
              value={
                daily.average_order_value === null
                  ? "—"
                  : formatRp(daily.average_order_value)
              }
            />
          </div>

          {(daily.refund_total > 0 || daily.tax_total > 0) && (
            <p className="mt-3 text-sm text-secondary">
              {daily.refund_total > 0 && (
                <>
                  Refund hari ini:{" "}
                  <span className="numeric font-semibold text-ink">
                    {formatRp(daily.refund_total)}
                  </span>{" "}
                  ({daily.refunds_count} pembayaran).{" "}
                </>
              )}
              {daily.tax_total > 0 && (
                <>
                  Pajak pada transaksi lunas:{" "}
                  <span className="numeric font-semibold text-ink">
                    {formatRp(daily.tax_total)}
                  </span>
                  .
                </>
              )}
            </p>
          )}

          {daily.paid_transaction_count === 0 && daily.shifts.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
                <ReceiptText size={32} aria-hidden />
              </span>
              <p className="mt-4 font-display text-h2 font-bold text-ink">
                Belum ada transaksi pada tanggal ini
              </p>
              <p className="mt-1 max-w-sm text-sm text-secondary">
                Laporan hanya menghitung transaksi yang sudah lunas. Coba tanggal lain atau
                tunggu transaksi pertama selesai dibayar.
              </p>
            </div>
          ) : (
            <>
              <section aria-label="Per metode pembayaran" className="mt-8">
                <h2 className="font-display text-h2 font-bold text-ink">Per Metode Pembayaran</h2>
                <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line bg-subtle text-left text-secondary">
                        <th scope="col" className="px-4 py-2.5 font-semibold">Metode</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Terkonfirmasi</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Menunggu</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Refund</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-semibold">Diterima Bersih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {daily.payment_methods.map((m) => (
                        <tr key={m.method}>
                          <td className="px-4 py-2.5 font-semibold text-ink">
                            {paymentMethodLabel(m.method)}
                          </td>
                          <td className="numeric px-4 py-2.5 text-right">
                            {formatRp(m.settled_amount)}{" "}
                            <span className="text-muted">({m.settled_count}×)</span>
                          </td>
                          <td className="numeric px-4 py-2.5 text-right">
                            {formatRp(m.pending_amount)}{" "}
                            <span className="text-muted">({m.pending_count}×)</span>
                          </td>
                          <td className="numeric px-4 py-2.5 text-right">
                            {formatRp(m.refunded_amount)}
                          </td>
                          <td className="numeric px-4 py-2.5 text-right font-semibold text-ink">
                            {formatRp(m.net_collected)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Pembayaran menunggu konfirmasi belum masuk penerimaan sampai dikonfirmasi
                  pemilik/manager.
                </p>
              </section>

              <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
                <section aria-label="Produk terlaris">
                  <h2 className="font-display text-h2 font-bold text-ink">Produk Terlaris</h2>
                  {products.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-6 text-sm text-secondary">
                      Belum ada produk terjual pada tanggal ini.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
                      <table className="w-full min-w-[420px] text-sm">
                        <thead>
                          <tr className="border-b border-line bg-subtle text-left text-secondary">
                            <th scope="col" className="px-4 py-2.5 font-semibold">Produk</th>
                            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Terjual</th>
                            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Omzet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {products.map((p) => (
                            <tr key={p.product_id ?? p.product_name ?? "?"}>
                              <td className="px-4 py-2.5 font-semibold text-ink">
                                {p.product_name ?? "Produk terhapus"}
                                <span className="block text-xs font-normal text-muted">
                                  {p.order_count} pesanan
                                </span>
                              </td>
                              <td className="numeric px-4 py-2.5 text-right">{p.qty_sold}</td>
                              <td className="numeric px-4 py-2.5 text-right font-semibold text-ink">
                                {formatRp(p.gross_revenue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section aria-label="Per kategori">
                  <h2 className="font-display text-h2 font-bold text-ink">Per Kategori</h2>
                  {categories.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-6 text-sm text-secondary">
                      Belum ada penjualan per kategori pada tanggal ini.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
                      <table className="w-full min-w-[420px] text-sm">
                        <thead>
                          <tr className="border-b border-line bg-subtle text-left text-secondary">
                            <th scope="col" className="px-4 py-2.5 font-semibold">Kategori</th>
                            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Terjual</th>
                            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Omzet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {categories.map((c) => (
                            <tr key={c.category_id ?? c.category_name ?? "?"}>
                              <td className="px-4 py-2.5 font-semibold text-ink">
                                {c.category_name ?? "Tanpa kategori"}
                                <span className="block text-xs font-normal text-muted">
                                  {c.product_count} produk · {c.order_count} pesanan
                                </span>
                              </td>
                              <td className="numeric px-4 py-2.5 text-right">{c.qty_sold}</td>
                              <td className="numeric px-4 py-2.5 text-right font-semibold text-ink">
                                {formatRp(c.gross_revenue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>

              <section aria-label="Shift hari ini" className="mt-8">
                <h2 className="font-display text-h2 font-bold text-ink">Shift Hari Ini</h2>
                {daily.shifts.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-6 text-sm text-secondary">
                    Tidak ada shift yang dibuka pada tanggal ini.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
                    {daily.shifts.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink">
                            Shift {shiftStatusLabel(s.status)} · dibuka {formatTime(s.opened_at)}
                            {s.closed_at ? ` · ditutup ${formatTime(s.closed_at)}` : ""}
                          </p>
                          <p className="numeric text-xs text-muted">
                            {s.orders_count} pesanan · tunai terkonfirmasi{" "}
                            {formatRp(s.settled_cash_amount)} · modal awal{" "}
                            {formatRp(s.opening_cash)}
                            {s.difference !== null &&
                              ` · selisih ${formatRp(s.difference)}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void openShiftDetail(s.id)}
                          disabled={shiftLoadingId === s.id}
                          className="min-h-[44px] rounded-md border border-line px-3 text-sm font-semibold text-primary-text hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {shiftLoadingId === s.id ? "Memuat…" : "Rekonsiliasi"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      ) : null}

      {shiftDetail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Rekonsiliasi shift">
          <button
            type="button"
            aria-label="Tutup rekonsiliasi"
            onClick={() => setShiftDetail(null)}
            className="absolute inset-0 h-full w-full bg-slate-900/50"
          />
          <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-xl bg-surface sm:rounded-lg">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-display text-h2 font-bold text-ink">Rekonsiliasi Shift</h2>
                <p className="text-sm text-secondary">
                  {shiftStatusLabel(shiftDetail.shift.status)} · dibuka{" "}
                  {formatDateTime(shiftDetail.shift.opened_at)}
                  {shiftDetail.shift.closed_at
                    ? ` · ditutup ${formatDateTime(shiftDetail.shift.closed_at)}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShiftDetail(null)}
                aria-label="Tutup rekonsiliasi"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <dl className="numeric space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-secondary">Modal awal</dt><dd className="font-semibold">{formatRp(shiftDetail.reconciliation.opening_cash)}</dd></div>
                <div className="flex justify-between"><dt className="text-secondary">Tunai terkonfirmasi</dt><dd className="font-semibold">{formatRp(shiftDetail.reconciliation.cash_receipts_settled)}</dd></div>
                <div className="flex justify-between"><dt className="text-secondary">Mutasi kas manual</dt><dd className="font-semibold">{formatRp(shiftDetail.reconciliation.cash_movements_total)}</dd></div>
                {shiftDetail.reconciliation.cash_refunds > 0 && (
                  <div className="flex justify-between"><dt className="text-secondary">Refund tunai</dt><dd className="font-semibold">−{formatRp(shiftDetail.reconciliation.cash_refunds)}</dd></div>
                )}
                <div className="flex items-baseline justify-between border-t border-line pt-2">
                  <dt className="font-semibold">Tunai seharusnya (expected)</dt>
                  <dd className="font-display text-price font-bold">{formatRp(shiftDetail.reconciliation.expected_cash_computed)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">Tunai terhitung saat tutup</dt>
                  <dd className="font-semibold">
                    {shiftDetail.reconciliation.counted_cash === null
                      ? "— (shift belum ditutup)"
                      : formatRp(shiftDetail.reconciliation.counted_cash)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">Selisih</dt>
                  <dd className={`font-semibold ${shiftDetail.reconciliation.difference_computed !== null && shiftDetail.reconciliation.difference_computed !== 0 ? "text-danger" : ""}`}>
                    {shiftDetail.reconciliation.difference_computed === null
                      ? "—"
                      : formatRp(shiftDetail.reconciliation.difference_computed)}
                  </dd>
                </div>
              </dl>

              {shiftDetail.payment_methods_settled.length > 0 && (
                <>
                  <h3 className="mt-5 font-display text-h3 font-semibold text-ink">Penerimaan per metode</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {shiftDetail.payment_methods_settled.map((m) => (
                      <li key={m.method} className="numeric flex justify-between">
                        <span className="text-secondary">{paymentMethodLabel(m.method)} ({m.count}×)</span>
                        <span className="font-semibold">{formatRp(m.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {shiftDetail.cash_movements.length > 0 && (
                <>
                  <h3 className="mt-5 font-display text-h3 font-semibold text-ink">Mutasi kas</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {shiftDetail.cash_movements.map((mv) => (
                      <li key={mv.id} className="flex justify-between gap-3">
                        <span className="text-secondary">
                          {formatTime(mv.created_at)} · {mv.type}
                          {mv.reason ? ` — ${mv.reason}` : ""}
                        </span>
                        <span className="numeric font-semibold">{formatRp(mv.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <h3 className="mt-5 font-display text-h3 font-semibold text-ink">
                Pesanan shift ini ({shiftDetail.orders.length})
              </h3>
              {shiftDetail.orders.length === 0 ? (
                <p className="mt-2 text-sm text-secondary">Belum ada pesanan pada shift ini.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {shiftDetail.orders.map((o) => (
                    <li key={o.id} className="numeric flex items-center justify-between gap-3 py-1.5">
                      <span className="font-semibold text-ink">{o.order_no}</span>
                      <span className="text-xs text-muted">
                        {o.payment_status === "paid" ? "Lunas" : o.payment_status}
                      </span>
                      <span className="font-semibold">{formatRp(o.grand_total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
