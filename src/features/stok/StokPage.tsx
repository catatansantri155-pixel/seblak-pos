/**
 * Halaman Stok — saldo bahan SELALU agregat stock_movements dari server
 * (tidak ada angka lokal). Gerakan manual mengikuti aturan server:
 * purchase boleh kasir; adjustment/waste/return hanya owner/manager;
 * catatan wajib untuk adjustment & waste; saldo tidak boleh negatif.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Package } from "lucide-react";
import { useAuth } from "../../app/auth";
import {
  createStockMovement,
  isApiError,
  listProducts,
  newIdempotencyKey,
  stockBalances,
  stockMovements,
  type StockBalance,
  type StockMovement,
  type StockMovementType,
} from "../../lib/api";
import {
  formatDateTime,
  humanError,
  stockMovementTypeLabel,
} from "../../lib/format";

type Direction = "in" | "out";

export default function StokPage() {
  const { user } = useAuth();
  const canAdjust = user?.role === "owner" || user?.role === "manager";

  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState("");
  const [type, setType] = useState<StockMovementType>("purchase");
  const [direction, setDirection] = useState<Direction>("in");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bal, mov, prods] = await Promise.all([
        stockBalances(),
        stockMovements({ per_page: 20 }),
        listProducts().catch(() => null),
      ]);
      setBalances(bal.items);
      setMovements(mov.items);
      const names = new Map<string, string>();
      for (const b of bal.items) names.set(b.product_id, b.name);
      if (prods) for (const p of prods.items) names.set(p.id, p.name);
      setProductNames(names);
      setProductId((prev) => prev || (bal.items[0]?.product_id ?? ""));
    } catch (err) {
      setError(humanError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOptions = useMemo(() => {
    const all: { value: StockMovementType; label: string }[] = [
      { value: "purchase", label: "Pembelian (stok masuk)" },
      { value: "adjustment", label: "Penyesuaian" },
      { value: "waste", label: "Terbuang / Rusak (stok keluar)" },
      { value: "return", label: "Retur (stok masuk)" },
    ];
    return canAdjust ? all : all.filter((o) => o.value === "purchase");
  }, [canAdjust]);

  const noteRequired = type === "adjustment" || type === "waste";
  const qtyValue = Number.parseInt(qty.replace(/[^\d]/g, ""), 10);

  const submit = async () => {
    setFormError(null);
    setSuccess(null);
    if (!productId) {
      setFormError("Pilih produk dulu.");
      return;
    }
    if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
      setFormError("Jumlah harus bilangan bulat lebih dari 0.");
      return;
    }
    if (noteRequired && note.trim() === "") {
      setFormError(`Catatan wajib diisi untuk gerakan ${stockMovementTypeLabel(type)}.`);
      return;
    }
    let qtyDelta = qtyValue;
    if (type === "waste") qtyDelta = -qtyValue;
    if (type === "adjustment" && direction === "out") qtyDelta = -qtyValue;

    setSubmitting(true);
    try {
      const result = await createStockMovement(
        {
          product_id: productId,
          type,
          qty_delta: qtyDelta,
          note: note.trim() ? note.trim() : null,
        },
        newIdempotencyKey(),
      );
      const name = productNames.get(productId) ?? "Produk";
      setSuccess(
        `Gerakan tercatat. Saldo ${name} sekarang ${result.balance_after} (sebelumnya ${result.balance_before}).`,
      );
      setQty("");
      setNote("");
      await load();
    } catch (err) {
      if (isApiError(err) && err.code === "INSUFFICIENT_STOCK") {
        setFormError("Saldo stok tidak cukup untuk gerakan keluar ini.");
      } else {
        setFormError(humanError(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Belum bisa memuat data stok: {error}</span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Saldo bahan">
          <h2 className="font-display text-h2 font-bold text-ink">Saldo Bahan</h2>
          {loading ? (
            <p className="mt-3 text-sm text-muted">Memuat saldo…</p>
          ) : balances.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
                <Package size={32} aria-hidden />
              </span>
              <p className="mt-4 font-display text-h2 font-bold text-ink">Belum ada bahan terlacak</p>
              <p className="mt-1 max-w-sm text-sm text-secondary">
                Produk yang ditandai terlacak stoknya akan muncul di sini beserta saldonya.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle text-left text-secondary">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Bahan</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Saldo</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Ambang Menipis</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {balances.map((b) => (
                    <tr key={b.product_id}>
                      <td className="px-4 py-2.5 font-semibold text-ink">
                        {b.name}
                        {b.sku && (
                          <span className="block text-xs font-normal text-muted">{b.sku}</span>
                        )}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right font-display text-price font-bold">
                        {b.balance}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right">
                        {b.min_stock > 0 ? b.min_stock : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {b.low_stock ? (
                          <span className="inline-flex rounded-full bg-warning-bg px-2.5 py-1 text-xs font-bold text-warning">
                            Menipis
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-success-bg px-2.5 py-1 text-xs font-bold text-success">
                            Aman
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="mt-8 font-display text-h2 font-bold text-ink">Gerakan Terbaru</h2>
          {movements.length === 0 ? (
            <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-6 text-sm text-secondary">
              Belum ada gerakan stok tercatat.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      {productNames.get(m.product_id) ?? "Produk"}
                      <span className="ml-2 text-xs font-medium text-muted">
                        {stockMovementTypeLabel(m.type)}
                        {m.ref_type === "order" ? " · dari pesanan" : ""}
                        {m.ref_type === "manual" ? " · manual" : ""}
                      </span>
                    </p>
                    {m.note && <p className="truncate text-xs text-muted">“{m.note}”</p>}
                    <p className="text-xs text-muted">{formatDateTime(m.created_at)}</p>
                  </div>
                  <span
                    className={`numeric font-display text-price font-bold ${
                      m.qty_delta >= 0 ? "text-success" : "text-danger"
                    }`}
                  >
                    {m.qty_delta >= 0 ? `+${m.qty_delta}` : m.qty_delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Gerakan manual" className="h-fit rounded-lg border border-line bg-surface p-5">
          <h2 className="font-display text-h2 font-bold text-ink">Gerakan Manual</h2>
          {!canAdjust && (
            <p className="mt-1 text-xs text-muted">
              Peran kasir hanya boleh mencatat pembelian. Penyesuaian, buang, dan retur khusus
              pemilik/manager.
            </p>
          )}
          {formError && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
              <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          {success && (
            <div role="status" className="mt-3 flex items-start gap-2 rounded-md bg-success-bg px-3 py-2.5 text-sm font-medium text-success">
              <CircleCheck size={18} aria-hidden className="mt-0.5 shrink-0" />
              <span>{success}</span>
            </div>
          )}
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="mv-product" className="mb-1.5 block text-sm font-semibold text-ink">Produk</label>
              <select
                id="mv-product"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
              >
                {balances.length === 0 && <option value="">— belum ada produk —</option>}
                {balances.map((b) => (
                  <option key={b.product_id} value={b.product_id}>
                    {b.name} (saldo {b.balance})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mv-type" className="mb-1.5 block text-sm font-semibold text-ink">Tipe gerakan</label>
              <select
                id="mv-type"
                value={type}
                onChange={(e) => setType(e.target.value as StockMovementType)}
                className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
              >
                {typeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {type === "adjustment" && (
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-ink">Arah penyesuaian</span>
                <div className="flex gap-2" role="group" aria-label="Arah penyesuaian">
                  {(
                    [
                      ["in", "Tambah (+)"],
                      ["out", "Kurang (−)"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={direction === value}
                      onClick={() => setDirection(value)}
                      className={`min-h-[44px] flex-1 rounded-full border px-2 text-sm font-semibold ${
                        direction === value
                          ? "border-primary bg-primary-soft text-primary-text"
                          : "border-line bg-surface text-secondary hover:bg-subtle"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="mv-qty" className="mb-1.5 block text-sm font-semibold text-ink">Jumlah</label>
              <input
                id="mv-qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="numeric min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="mv-note" className="mb-1.5 block text-sm font-semibold text-ink">
                Catatan{noteRequired ? " (wajib)" : " (opsional)"}
              </label>
              <input
                id="mv-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={type === "waste" ? "Mis. basi / rusak" : "Keterangan gerakan"}
                className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || balances.length === 0}
              className="min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Menyimpan…" : "Simpan Gerakan"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
