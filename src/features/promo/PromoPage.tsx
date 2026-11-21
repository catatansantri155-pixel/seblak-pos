/**
 * Halaman Promo — kelola definisi promo (aturan Fajar): penerapan promo
 * selalu dihitung server saat order dibuat; halaman ini hanya mengelola
 * definisinya. Config per tipe mengikuti validasi server persis:
 * - percent   : percent 1..100, product_id opsional
 * - nominal   : amount >= 1, min_subtotal opsional
 * - bogo      : product_id, buy_qty >= 1, free_qty >= 1
 * - bundle    : items[{product_id, qty}] non-kosong, bundle_price >= 0
 * - free_item : free_product_id, qty opsional, min_subtotal opsional
 * Kode promo unik per outlet (duplikat -> CONFLICT dari server).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Plus, Tag, Trash, X } from "lucide-react";
import {
  createPromotion,
  isApiError,
  listProducts,
  listPromotions,
  patchPromotion,
  type Product,
  type Promotion,
  type PromotionInput,
  type PromotionType,
} from "../../lib/api";
import {
  formatRp,
  formatRpInput,
  humanError,
  parseRpInput,
  promotionTypeLabel,
} from "../../lib/format";

const TYPE_OPTIONS: { value: PromotionType; label: string }[] = [
  { value: "percent", label: "Diskon Persen" },
  { value: "nominal", label: "Potongan Nominal" },
  { value: "bogo", label: "Beli X Gratis Y" },
  { value: "free_item", label: "Item Gratis" },
  { value: "bundle", label: "Paket (Bundle)" },
];

interface BundleRow {
  product_id: string;
  qty: string;
}

function cfgNum(cfg: Record<string, unknown>, key: string): number | null {
  const v = cfg[key];
  return typeof v === "number" ? v : null;
}

function cfgStr(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v : "";
}

function toLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function formatPeriod(ms: number | null): string {
  if (ms === null) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function configSummary(promo: Promotion, productName: (id: string) => string): string {
  const cfg = promo.config;
  switch (promo.type) {
    case "percent": {
      const pct = cfgNum(cfg, "percent");
      const pid = cfgStr(cfg, "product_id");
      return `Diskon ${pct ?? "?"}%${pid ? ` untuk ${productName(pid)}` : " semua produk"}`;
    }
    case "nominal": {
      const amount = cfgNum(cfg, "amount");
      const min = cfgNum(cfg, "min_subtotal");
      return `Potongan ${amount !== null ? formatRp(amount) : "?"}${min ? ` (min. belanja ${formatRp(min)})` : ""}`;
    }
    case "bogo": {
      const pid = cfgStr(cfg, "product_id");
      return `Beli ${cfgNum(cfg, "buy_qty") ?? "?"} gratis ${cfgNum(cfg, "free_qty") ?? "?"} — ${productName(pid)}`;
    }
    case "free_item": {
      const pid = cfgStr(cfg, "free_product_id");
      const min = cfgNum(cfg, "min_subtotal");
      return `Gratis ${cfgNum(cfg, "qty") ?? 1}× ${productName(pid)}${min ? ` (min. belanja ${formatRp(min)})` : ""}`;
    }
    case "bundle": {
      const items = Array.isArray(cfg["items"]) ? (cfg["items"] as unknown[]) : [];
      const price = cfgNum(cfg, "bundle_price");
      return `Paket ${items.length} item seharga ${price !== null ? formatRp(price) : "?"}`;
    }
    default:
      return promo.type;
  }
}

const inputCls =
  "min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary";
const labelCls = "mb-1.5 block text-sm font-semibold text-ink";

export default function PromoPage() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Formulir (buat & ubah berbagi state; editingId null = buat baru).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState<PromotionType>("percent");
  const [stackable, setStackable] = useState(false);
  const [maxDiscount, setMaxDiscount] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [formActive, setFormActive] = useState(true);
  // Config per tipe:
  const [percent, setPercent] = useState("");
  const [percentProductId, setPercentProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [nominalMin, setNominalMin] = useState("");
  const [bogoProductId, setBogoProductId] = useState("");
  const [buyQty, setBuyQty] = useState("2");
  const [freeQty, setFreeQty] = useState("1");
  const [freeProductId, setFreeProductId] = useState("");
  const [freeItemQty, setFreeItemQty] = useState("1");
  const [freeItemMin, setFreeItemMin] = useState("");
  const [bundleItems, setBundleItems] = useState<BundleRow[]>([{ product_id: "", qty: "1" }]);
  const [bundlePrice, setBundlePrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const productName = useCallback(
    (id: string): string => products.find((p) => p.id === id)?.name ?? "Produk",
    [products],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [promoPage, prodPage] = await Promise.all([
        listPromotions(),
        listProducts().catch(() => null),
      ]);
      setPromos(promoPage.items);
      if (prodPage) setProducts(prodPage.items);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName("");
    setCode("");
    setType("percent");
    setStackable(false);
    setMaxDiscount("");
    setStartsAt("");
    setEndsAt("");
    setFormActive(true);
    setPercent("");
    setPercentProductId("");
    setAmount("");
    setNominalMin("");
    setBogoProductId("");
    setBuyQty("2");
    setFreeQty("1");
    setFreeProductId("");
    setFreeItemQty("1");
    setFreeItemMin("");
    setBundleItems([{ product_id: "", qty: "1" }]);
    setBundlePrice("");
    setFormError(null);
  }, []);

  const startEdit = (promo: Promotion) => {
    resetForm();
    setEditingId(promo.id);
    setName(promo.name);
    setCode(promo.code ?? "");
    setType(promo.type);
    setStackable(promo.is_stackable);
    setMaxDiscount(promo.max_discount !== null ? formatRpInput(promo.max_discount) : "");
    setStartsAt(toLocalInput(promo.starts_at));
    setEndsAt(toLocalInput(promo.ends_at));
    setFormActive(promo.is_active);
    const cfg = promo.config;
    if (promo.type === "percent") {
      setPercent(String(cfgNum(cfg, "percent") ?? ""));
      setPercentProductId(cfgStr(cfg, "product_id"));
    } else if (promo.type === "nominal") {
      setAmount(formatRpInput(cfgNum(cfg, "amount") ?? 0));
      setNominalMin(formatRpInput(cfgNum(cfg, "min_subtotal") ?? 0));
    } else if (promo.type === "bogo") {
      setBogoProductId(cfgStr(cfg, "product_id"));
      setBuyQty(String(cfgNum(cfg, "buy_qty") ?? 2));
      setFreeQty(String(cfgNum(cfg, "free_qty") ?? 1));
    } else if (promo.type === "free_item") {
      setFreeProductId(cfgStr(cfg, "free_product_id"));
      setFreeItemQty(String(cfgNum(cfg, "qty") ?? 1));
      setFreeItemMin(formatRpInput(cfgNum(cfg, "min_subtotal") ?? 0));
    } else if (promo.type === "bundle") {
      const items = Array.isArray(cfg["items"]) ? (cfg["items"] as Record<string, unknown>[]) : [];
      setBundleItems(
        items.length > 0
          ? items.map((it) => ({
              product_id: cfgStr(it, "product_id"),
              qty: String(cfgNum(it, "qty") ?? 1),
            }))
          : [{ product_id: "", qty: "1" }],
      );
      setBundlePrice(formatRpInput(cfgNum(cfg, "bundle_price") ?? 0));
    }
  };

  type ConfigResult =
    | { ok: true; config: Record<string, unknown> }
    | { ok: false; error: string };

  const buildConfig = (): ConfigResult => {
    const intOf = (raw: string) => Number.parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (type === "percent") {
      const pct = intOf(percent);
      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        return { ok: false, error: "Persen diskon harus antara 1 dan 100." };
      }
      const cfg: Record<string, unknown> = { percent: pct };
      if (percentProductId) cfg["product_id"] = percentProductId;
      return { ok: true, config: cfg };
    }
    if (type === "nominal") {
      const amt = parseRpInput(amount);
      if (amt < 1) return { ok: false, error: "Nominal potongan minimal Rp1." };
      const cfg: Record<string, unknown> = { amount: amt };
      const min = parseRpInput(nominalMin);
      if (min > 0) cfg["min_subtotal"] = min;
      return { ok: true, config: cfg };
    }
    if (type === "bogo") {
      if (!bogoProductId) return { ok: false, error: "Pilih produk untuk promo beli-gratis." };
      const buy = intOf(buyQty);
      const free = intOf(freeQty);
      if (!Number.isFinite(buy) || buy < 1 || !Number.isFinite(free) || free < 1) {
        return { ok: false, error: "Jumlah beli dan gratis minimal 1." };
      }
      return { ok: true, config: { product_id: bogoProductId, buy_qty: buy, free_qty: free } };
    }
    if (type === "free_item") {
      if (!freeProductId) return { ok: false, error: "Pilih produk gratisnya." };
      const q = intOf(freeItemQty);
      if (!Number.isFinite(q) || q < 1) return { ok: false, error: "Jumlah item gratis minimal 1." };
      const cfg: Record<string, unknown> = { free_product_id: freeProductId, qty: q };
      const min = parseRpInput(freeItemMin);
      if (min > 0) cfg["min_subtotal"] = min;
      return { ok: true, config: cfg };
    }
    // bundle
    const rows = bundleItems.filter((r) => r.product_id);
    if (rows.length === 0) return { ok: false, error: "Paket harus berisi minimal 1 produk." };
    const items: { product_id: string; qty: number }[] = [];
    for (const r of rows) {
      const q = intOf(r.qty);
      if (!Number.isFinite(q) || q < 1) return { ok: false, error: "Jumlah tiap item paket minimal 1." };
      items.push({ product_id: r.product_id, qty: q });
    }
    return { ok: true, config: { items, bundle_price: parseRpInput(bundlePrice) } };
  };

  const onSave = async () => {
    setFormError(null);
    setSuccess(null);
    if (!name.trim()) {
      setFormError("Nama promo wajib diisi.");
      return;
    }
    const cfg = buildConfig();
    if (!cfg.ok) {
      setFormError(cfg.error);
      return;
    }
    const starts = fromLocalInput(startsAt);
    const ends = fromLocalInput(endsAt);
    if (starts !== null && ends !== null && ends <= starts) {
      setFormError("Tanggal berakhir harus setelah tanggal mulai.");
      return;
    }
    const input: PromotionInput = {
      name: name.trim(),
      code: code.trim() ? code.trim() : null,
      type,
      config: cfg.config,
      starts_at: starts,
      ends_at: ends,
      is_stackable: stackable,
      max_discount: maxDiscount.trim() ? parseRpInput(maxDiscount) : null,
      is_active: formActive,
    };
    setSaving(true);
    try {
      if (editingId) {
        await patchPromotion(editingId, input);
        setSuccess(`Promo "${input.name}" diperbarui.`);
      } else {
        await createPromotion(input);
        setSuccess(`Promo "${input.name}" dibuat.`);
      }
      resetForm();
      await load();
    } catch (err) {
      if (isApiError(err) && err.code === "CONFLICT") {
        setFormError("Kode promo sudah dipakai promo lain di outlet ini.");
      } else {
        setFormError(humanError(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (promo: Promotion) => {
    setRowError(null);
    setSuccess(null);
    setBusyId(promo.id);
    try {
      await patchPromotion(promo.id, { is_active: !promo.is_active });
      setSuccess(
        promo.is_active
          ? `Promo "${promo.name}" dinonaktifkan.`
          : `Promo "${promo.name}" diaktifkan.`,
      );
      await load();
    } catch (err) {
      setRowError(humanError(err));
    } finally {
      setBusyId(null);
    }
  };

  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, name: p.name })),
    [products],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>Belum bisa memuat daftar promo: {error}</span>
        </div>
      )}
      {success && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-md bg-success-bg px-3 py-2.5 text-sm font-medium text-success">
          <CircleCheck size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {rowError && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
          <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
          <span>{rowError}</span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Daftar promo">
          <h2 className="font-display text-h2 font-bold text-ink">Daftar Promo</h2>
          {loading ? (
            <p className="mt-3 text-sm text-muted">Memuat promo…</p>
          ) : promos.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
                <Tag size={32} aria-hidden />
              </span>
              <p className="mt-4 font-display text-h2 font-bold text-ink">Belum ada promo</p>
              <p className="mt-1 max-w-sm text-sm text-secondary">
                Buat promo pertama lewat formulir di samping. Kasir memakainya lewat kode promo
                saat checkout.
              </p>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {promos.map((promo) => (
                <li key={promo.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {promo.name}
                        {promo.code && (
                          <span className="numeric ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary-text">
                            {promo.code}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-secondary">
                        {promotionTypeLabel(promo.type)} · {configSummary(promo, productName)}
                      </p>
                      <p className="text-xs text-muted">
                        Berlaku {formatPeriod(promo.starts_at)} s.d. {formatPeriod(promo.ends_at)}
                        {promo.is_stackable ? " · bisa digabung promo lain" : " · tidak bisa digabung"}
                        {promo.max_discount !== null &&
                          ` · maks. diskon ${formatRp(promo.max_discount)}`}
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                        promo.is_active ? "bg-success-bg text-success" : "bg-subtle text-muted"
                      }`}
                    >
                      {promo.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(promo)}
                        className="min-h-[40px] rounded-md border border-line px-3 text-sm font-semibold text-secondary hover:bg-subtle"
                      >
                        Ubah
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(promo)}
                        disabled={busyId === promo.id}
                        className="min-h-[40px] rounded-md border border-line px-3 text-sm font-semibold text-primary-text hover:bg-subtle disabled:opacity-60"
                      >
                        {promo.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Formulir promo" className="h-fit rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-h2 font-bold text-ink">
              {editingId ? "Ubah Promo" : "Buat Promo"}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="flex min-h-[36px] items-center gap-1 rounded-md px-2 text-sm font-semibold text-secondary hover:bg-subtle"
              >
                <X size={16} aria-hidden /> Batal ubah
              </button>
            )}
          </div>
          {formError && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
              <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="pr-name" className={labelCls}>Nama promo</label>
              <input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mis. Hemat Akhir Pekan" className={inputCls} />
            </div>
            <div>
              <label htmlFor="pr-code" className={labelCls}>Kode promo (unik, opsional)</label>
              <input id="pr-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Mis. HEMAT10" className={`${inputCls} uppercase`} />
            </div>
            <div>
              <label htmlFor="pr-type" className={labelCls}>Tipe promo</label>
              <select id="pr-type" value={type} onChange={(e) => setType(e.target.value as PromotionType)} className={inputCls}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {type === "percent" && (
              <>
                <div>
                  <label htmlFor="pr-percent" className={labelCls}>Persen diskon (1–100)</label>
                  <input id="pr-percent" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, ""))} placeholder="10" className={`${inputCls} numeric`} />
                </div>
                <div>
                  <label htmlFor="pr-percent-product" className={labelCls}>Khusus produk (opsional)</label>
                  <select id="pr-percent-product" value={percentProductId} onChange={(e) => setPercentProductId(e.target.value)} className={inputCls}>
                    <option value="">Semua produk</option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {type === "nominal" && (
              <>
                <div>
                  <label htmlFor="pr-amount" className={labelCls}>Nominal potongan (Rp)</label>
                  <input id="pr-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(formatRpInput(parseRpInput(e.target.value)))} placeholder="5.000" className={`${inputCls} numeric`} />
                </div>
                <div>
                  <label htmlFor="pr-nominal-min" className={labelCls}>Belanja minimal (Rp, opsional)</label>
                  <input id="pr-nominal-min" inputMode="numeric" value={nominalMin} onChange={(e) => setNominalMin(formatRpInput(parseRpInput(e.target.value)))} placeholder="0" className={`${inputCls} numeric`} />
                </div>
              </>
            )}

            {type === "bogo" && (
              <>
                <div>
                  <label htmlFor="pr-bogo-product" className={labelCls}>Produk</label>
                  <select id="pr-bogo-product" value={bogoProductId} onChange={(e) => setBogoProductId(e.target.value)} className={inputCls}>
                    <option value="">— pilih produk —</option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pr-buy" className={labelCls}>Beli (qty)</label>
                    <input id="pr-buy" inputMode="numeric" value={buyQty} onChange={(e) => setBuyQty(e.target.value.replace(/[^\d]/g, ""))} className={`${inputCls} numeric`} />
                  </div>
                  <div>
                    <label htmlFor="pr-free" className={labelCls}>Gratis (qty)</label>
                    <input id="pr-free" inputMode="numeric" value={freeQty} onChange={(e) => setFreeQty(e.target.value.replace(/[^\d]/g, ""))} className={`${inputCls} numeric`} />
                  </div>
                </div>
              </>
            )}

            {type === "free_item" && (
              <>
                <div>
                  <label htmlFor="pr-free-product" className={labelCls}>Produk gratis</label>
                  <select id="pr-free-product" value={freeProductId} onChange={(e) => setFreeProductId(e.target.value)} className={inputCls}>
                    <option value="">— pilih produk —</option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pr-free-qty" className={labelCls}>Jumlah gratis</label>
                    <input id="pr-free-qty" inputMode="numeric" value={freeItemQty} onChange={(e) => setFreeItemQty(e.target.value.replace(/[^\d]/g, ""))} className={`${inputCls} numeric`} />
                  </div>
                  <div>
                    <label htmlFor="pr-free-min" className={labelCls}>Belanja minimal (Rp, opsional)</label>
                    <input id="pr-free-min" inputMode="numeric" value={freeItemMin} onChange={(e) => setFreeItemMin(formatRpInput(parseRpInput(e.target.value)))} placeholder="0" className={`${inputCls} numeric`} />
                  </div>
                </div>
              </>
            )}

            {type === "bundle" && (
              <>
                <div>
                  <span className={labelCls}>Isi paket</span>
                  <div className="space-y-2">
                    {bundleItems.map((row, idx) => (
                      <div key={idx} className="flex gap-2">
                        <select
                          aria-label={`Produk paket ${idx + 1}`}
                          value={row.product_id}
                          onChange={(e) =>
                            setBundleItems((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, product_id: e.target.value } : r)),
                            )
                          }
                          className="min-h-[48px] min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
                        >
                          <option value="">— pilih produk —</option>
                          {productOptions.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <input
                          aria-label={`Jumlah item paket ${idx + 1}`}
                          inputMode="numeric"
                          value={row.qty}
                          onChange={(e) =>
                            setBundleItems((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, qty: e.target.value.replace(/[^\d]/g, "") } : r)),
                            )
                          }
                          className="numeric min-h-[48px] w-20 rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-primary"
                        />
                        {bundleItems.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Hapus item paket ${idx + 1}`}
                            onClick={() => setBundleItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="flex h-12 w-11 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger-bg"
                          >
                            <Trash size={18} aria-hidden />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setBundleItems((prev) => [...prev, { product_id: "", qty: "1" }])}
                    className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-md border border-line px-3 text-sm font-semibold text-primary-text hover:bg-subtle"
                  >
                    <Plus size={16} aria-hidden /> Tambah Item
                  </button>
                </div>
                <div>
                  <label htmlFor="pr-bundle-price" className={labelCls}>Harga paket (Rp)</label>
                  <input id="pr-bundle-price" inputMode="numeric" value={bundlePrice} onChange={(e) => setBundlePrice(formatRpInput(parseRpInput(e.target.value)))} placeholder="45.000" className={`${inputCls} numeric`} />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pr-starts" className={labelCls}>Mulai (opsional)</label>
                <input id="pr-starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="pr-ends" className={labelCls}>Berakhir (opsional)</label>
                <input id="pr-ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div>
              <label htmlFor="pr-max" className={labelCls}>Batas maks. diskon (Rp, opsional)</label>
              <input id="pr-max" inputMode="numeric" value={maxDiscount} onChange={(e) => setMaxDiscount(formatRpInput(parseRpInput(e.target.value)))} placeholder="Tanpa batas" className={`${inputCls} numeric`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={stackable}
                onClick={() => setStackable((v) => !v)}
                className={`min-h-[44px] rounded-full border px-3.5 text-sm font-semibold ${
                  stackable
                    ? "border-primary bg-primary-soft text-primary-text"
                    : "border-line bg-surface text-secondary hover:bg-subtle"
                }`}
              >
                Bisa digabung promo lain: {stackable ? "Ya" : "Tidak"}
              </button>
              <button
                type="button"
                aria-pressed={formActive}
                onClick={() => setFormActive((v) => !v)}
                className={`min-h-[44px] rounded-full border px-3.5 text-sm font-semibold ${
                  formActive
                    ? "border-primary bg-primary-soft text-primary-text"
                    : "border-line bg-surface text-secondary hover:bg-subtle"
                }`}
              >
                Status: {formActive ? "Aktif" : "Nonaktif"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Buat Promo"}
            </button>
            <p className="text-xs text-muted">
              Keputusan akhir selalu di server: config yang tidak sah atau kode yang dobel akan
              ditolak dengan pesan yang ditampilkan di sini.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
