/**
 * Halaman Shift Kas: lihat shift terbuka milik pengguna, buka shift baru
 * (modal awal), dan tutup shift (uang terhitung -> server menghitung uang
 * seharusnya & selisihnya).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarClock, CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import {
  closeShift,
  currentShift,
  isApiError,
  openShift,
  type CloseShiftResult,
  type Shift,
} from "../../lib/api";
import { formatDateTime, formatRp, formatRpInput, humanError, parseRpInput } from "../../lib/format";

export default function ShiftPage() {
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [closeResult, setCloseResult] = useState<CloseShiftResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await currentShift();
      setShift(s);
    } catch (err) {
      if (isApiError(err) && err.code === "SHIFT_NOT_OPEN") {
        setShift(null);
      } else {
        setError(humanError(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onOpen = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await openShift(parseRpInput(openingCash));
      setShift(s);
      setOpeningCash("");
    } catch (err) {
      setError(humanError(err));
      if (isApiError(err) && err.code === "CONFLICT") void load();
    } finally {
      setBusy(false);
    }
  };

  const onClose = async (e: FormEvent) => {
    e.preventDefault();
    if (!shift) return;
    setBusy(true);
    setError(null);
    try {
      const result = await closeShift(shift.id, parseRpInput(countedCash));
      setCloseResult(result);
      setShift(null);
      setCountedCash("");
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  };

  const moneyInputCls =
    "numeric min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-h2 font-bold text-ink">Shift Kas Saya</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="flex min-h-[44px] items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-secondary hover:bg-subtle"
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

      {closeResult && (
        <div className="mb-4 rounded-lg border border-line bg-surface p-5">
          <p className="flex items-center gap-2 font-display text-h3 font-semibold text-success">
            <CircleCheck size={20} aria-hidden /> Shift berhasil ditutup
          </p>
          <dl className="numeric mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-secondary">Modal awal</dt><dd className="font-semibold">{formatRp(closeResult.opening_cash)}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Penjualan tunai (terkonfirmasi)</dt><dd className="font-semibold">{formatRp(closeResult.cash_sales_total)}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Mutasi kas manual</dt><dd className="font-semibold">{formatRp(closeResult.cash_movements_total)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1.5"><dt className="text-secondary">Uang seharusnya</dt><dd className="font-semibold">{formatRp(closeResult.expected_cash ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Uang terhitung</dt><dd className="font-semibold">{formatRp(closeResult.counted_cash ?? 0)}</dd></div>
            <div className="flex justify-between">
              <dt className="text-secondary">Selisih</dt>
              <dd className={`font-bold ${(closeResult.difference ?? 0) === 0 ? "text-success" : "text-danger"}`}>
                {formatRp(closeResult.difference ?? 0)}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Memuat status shift…</p>
      ) : shift ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="flex items-center gap-2 font-display text-h3 font-semibold text-ink">
            <CalendarClock size={20} aria-hidden className="text-primary-text" />
            Shift sedang terbuka
          </p>
          <dl className="numeric mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-secondary">Dibuka</dt><dd className="font-semibold">{formatDateTime(shift.opened_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Modal awal</dt><dd className="font-semibold">{formatRp(shift.opening_cash)}</dd></div>
          </dl>

          <form onSubmit={onClose} className="mt-5 border-t border-line pt-4">
            <label htmlFor="counted" className="mb-1.5 block text-sm font-semibold text-ink">
              Tutup shift — uang tunai terhitung di laci
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="counted"
                inputMode="numeric"
                value={countedCash}
                onChange={(e) => setCountedCash(formatRpInput(parseRpInput(e.target.value)))}
                placeholder="0"
                className={moneyInputCls}
              />
              <button
                type="submit"
                disabled={busy || countedCash === ""}
                className="min-h-[48px] shrink-0 rounded-md bg-primary px-5 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Menutup…" : "Tutup Shift"}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Selesaikan pembayaran pesanan sebelum menutup shift. Server akan menghitung uang seharusnya dan selisihnya.
            </p>
          </form>
        </div>
      ) : (
        <form onSubmit={onOpen} className="rounded-lg border border-line bg-surface p-5">
          <p className="font-display text-h3 font-semibold text-ink">Belum ada shift terbuka</p>
          <p className="mt-1 text-sm text-secondary">
            Buka shift untuk mulai menerima pesanan di kasir.
          </p>
          <label htmlFor="opening" className="mb-1.5 mt-4 block text-sm font-semibold text-ink">
            Modal awal di laci (Rp)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="opening"
              inputMode="numeric"
              value={openingCash}
              onChange={(e) => setOpeningCash(formatRpInput(parseRpInput(e.target.value)))}
              placeholder="0"
              className={moneyInputCls}
            />
            <button
              type="submit"
              disabled={busy}
              className="min-h-[48px] shrink-0 rounded-md bg-primary px-5 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Membuka…" : "Buka Shift"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
