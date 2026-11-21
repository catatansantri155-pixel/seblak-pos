/**
 * Layar Kasir Seblak POS — nyata terhadap API G3a:
 * - Wajib shift terbuka; bila belum, layar terkunci di panel Buka Shift.
 * - Grid produk per kategori; klik produk membuka panel opsi (varian +
 *   grup modifier dari GET /products/:id): pilihan tunggal seperti
 *   Level Pedas (radio + ikon Flame), banyak pilihan seperti Topping
 *   berbayar (chip dengan harga tampil).
 * - Keranjang: ubah qty, hapus item, catatan per item. Subtotal keranjang
 *   hanya PRATINJAU lokal (diberi label perkiraan); total resmi selalu
 *   dari respons server setelah pesanan dibuat.
 * - Alur: Buat Pesanan (Idempotency-Key per checkout) -> total resmi server
 *   -> Pembayaran: tunai (kembalian dari server) / QRIS / transfer / EDC
 *   (pending, menunggu konfirmasi owner/manager) -> lunas -> Transaksi Baru.
 * - Offline: bila Buat Pesanan/Pembayaran gagal karena JARINGAN (bukan
 *   penolakan server), checkout masuk outbox localStorage (lib/outbox)
 *   berstatus "tercatat di perangkat, belum masuk server", lalu dikirim ke
 *   POST /sync/push saat koneksi kembali. Verdict server per entri tampil
 *   apa adanya: terkirim -> antrean bersih; ditolak -> alasan server
 *   ditampilkan dan entri menunggu keputusan kasir.
 *
 * Catatan data: produk bahan baku (is_stock_tracked = 1, mis. "Stok Bakso")
 * tidak ditampilkan di grid jual — sesuai desain G1a bahan dijual lewat opsi
 * modifier, bukan sebagai item kasir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Banknote,
  Check,
  CircleAlert,
  CircleCheck,
  Flame,
  Landmark,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShoppingBasket,
  ShoppingCart,
  Trash,
  UtensilsCrossed,
  Wallet,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "../../app/auth";
import {
  confirmPayment,
  createOrder,
  currentShift,
  getOrderDetail,
  getProductDetail,
  isApiError,
  listCategories,
  listProducts,
  newIdempotencyKey,
  openShift,
  payOrder,
  type Category,
  type CreateOrderInput,
  type ModifierGroup,
  type OrderDetail,
  type PayOrderResult,
  type PaymentMethod,
  type Product,
  type ProductDetail,
  type Shift,
} from "../../lib/api";
import {
  formatDateTime,
  formatRp,
  formatRpDelta,
  formatRpInput,
  humanError,
  parseRpInput,
  paymentMethodLabel,
} from "../../lib/format";
import {
  addOutboxEntry,
  loadOutbox,
  removeOutboxEntry,
  subscribeOutbox,
  syncOutbox,
  type OutboxEntry,
} from "../../lib/outbox";

// --------------------------------------------------------------------- types

interface CartModifier {
  modifier_option_id: string;
  name: string;
  price_delta: number;
  qty: number;
}

interface CartLine {
  key: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  qty: number;
  note: string | null;
  unit_base: number;
  modifiers: CartModifier[];
}

interface PanelState {
  detail: ProductDetail;
  variantId: string | null;
  selections: Record<string, string[]>;
  qty: number;
  note: string;
  error: string | null;
}

type Stage = "cart" | "paying";

/** Checkout yang gagal terkirim karena jaringan, menunggu keputusan kasir
 * untuk disimpan ke outbox offline. */
interface OfflinePromptState {
  input: CreateOrderInput;
  idempotencyKey: string;
  previewTotal: number;
  itemCount: number;
  itemSummary: string;
}

// --------------------------------------------------------------- idempotency

/** Kunci idempotensi per isi request: isi sama -> kunci sama (tekan ulang
 * aman); isi berubah -> kunci baru (server menolak kunci sama isi beda). */
function useKeyedIdempotency() {
  const store = useRef(new Map<string, { sig: string; key: string }>());
  const keyFor = (scope: string, signature: string): string => {
    const existing = store.current.get(scope);
    if (existing && existing.sig === signature) return existing.key;
    const key = newIdempotencyKey();
    store.current.set(scope, { sig: signature, key });
    return key;
  };
  return { keyFor, clearKeys: () => store.current.clear() };
}

// ------------------------------------------------------------------ stepper

function QtyStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={`Kurangi ${label}`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-line text-secondary hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus size={18} aria-hidden />
      </button>
      <span aria-live="polite" className="numeric w-8 text-center font-display text-base font-bold">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Tambah ${label}`}
        onClick={() => onChange(value + 1)}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-line text-secondary hover:bg-subtle"
      >
        <Plus size={18} aria-hidden />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------- page

export default function KasirPage() {
  const { user } = useAuth();
  const { keyFor, clearKeys } = useKeyedIdempotency();

  const [shift, setShift] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [openingCash, setOpeningCash] = useState("");
  const [openingBusy, setOpeningBusy] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const detailCache = useRef(new Map<string, ProductDetail>());
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [panelLoadingId, setPanelLoadingId] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway" | "online">("dine_in");
  const [promoInput, setPromoInput] = useState("");
  const [promoCodes, setPromoCodes] = useState<string[]>([]);

  const [outboxEntries, setOutboxEntries] = useState<OutboxEntry[]>(() => loadOutbox());
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [offlinePrompt, setOfflinePrompt] = useState<OfflinePromptState | null>(null);
  const [offlinePayMethod, setOfflinePayMethod] = useState<PaymentMethod | "none">("cash");
  const [offlineCash, setOfflineCash] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [stage, setStage] = useState<Stage>("cart");
  const [createdOrder, setCreatedOrder] = useState<OrderDetail | null>(null);
  const [creating, setCreating] = useState(false);

  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState<PayOrderResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [orderSettled, setOrderSettled] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // ------------------------------------------------------------ shift & data

  const loadShift = useCallback(async () => {
    setShiftLoading(true);
    try {
      const s = await currentShift();
      setShift(s);
    } catch (err) {
      if (isApiError(err) && err.code === "SHIFT_NOT_OPEN") setShift(null);
      else setError(humanError(err));
    } finally {
      setShiftLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const [cats, prods] = await Promise.all([listCategories(), listProducts()]);
      setCategories(cats.items);
      // Bahan baku stok tidak dijual langsung di kasir (lihat catatan di atas).
      setProducts(prods.items.filter((p) => !p.is_stock_tracked));
    } catch (err) {
      setError(humanError(err));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShift();
    void loadCatalog();
  }, [loadShift, loadCatalog]);

  // Outbox offline: tampilkan antrean terkini, lalu coba kirim otomatis
  // saat halaman dibuka dan setiap koneksi kembali (event "online").
  useEffect(() => {
    const refresh = () => setOutboxEntries(loadOutbox());
    refresh();
    const unsubscribe = subscribeOutbox(refresh);
    const trySync = () => {
      void syncOutbox()
        .then((summary) => {
          if (summary.completed > 0) {
            setSyncNotice(
              `Sinkronisasi otomatis: ${summary.completed} checkout terkirim ke server.`,
            );
          }
          refresh();
        })
        .catch(() => {
          // Sinkronisasi gagal (mis. sesi berakhir): antrean tetap tampil
          // apa adanya dan bisa dikirim manual lewat tombol Sinkronkan.
        });
    };
    trySync();
    window.addEventListener("online", trySync);
    return () => {
      unsubscribe();
      window.removeEventListener("online", trySync);
    };
  }, []);

  const onOpenShift = async () => {
    setOpeningBusy(true);
    setError(null);
    try {
      const s = await openShift(parseRpInput(openingCash));
      setShift(s);
    } catch (err) {
      setError(humanError(err));
      if (isApiError(err) && err.code === "CONFLICT") void loadShift();
    } finally {
      setOpeningBusy(false);
    }
  };

  // ---------------------------------------------------------------- catalog

  const visibleProducts = useMemo(() => {
    let list = products;
    if (activeCategory) list = list.filter((p) => p.category_id === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    return list;
  }, [products, activeCategory, search]);

  const ensureDetail = useCallback(async (id: string): Promise<ProductDetail> => {
    const cached = detailCache.current.get(id);
    if (cached) return cached;
    const detail = await getProductDetail(id);
    detailCache.current.set(id, detail);
    return detail;
  }, []);

  const addLine = useCallback(
    (
      detail: ProductDetail,
      variantId: string | null,
      modifiers: CartModifier[],
      qty: number,
      note: string,
    ) => {
      const variant = detail.variants.find((v) => v.id === variantId) ?? null;
      const line: CartLine = {
        key: newIdempotencyKey(),
        product_id: detail.id,
        product_name: detail.name,
        variant_id: variantId,
        variant_name: variant?.name ?? null,
        qty,
        note: note.trim() ? note.trim() : null,
        unit_base: detail.base_price + (variant?.price_delta ?? 0),
        modifiers,
      };
      setCart((prev) => [...prev, line]);
    },
    [],
  );

  const onProductClick = async (product: Product) => {
    setError(null);
    setPanelLoadingId(product.id);
    try {
      const detail = await ensureDetail(product.id);
      if (detail.variants.length === 0 && detail.modifiers.length === 0) {
        addLine(detail, null, [], 1, "");
        return;
      }
      const selections: Record<string, string[]> = {};
      for (const group of detail.modifiers) {
        if (group.selection_type === "single" && group.is_required && group.options.length > 0) {
          const first = group.options[0];
          if (first) selections[group.id] = [first.id];
        } else {
          selections[group.id] = [];
        }
      }
      setPanel({
        detail,
        variantId: detail.variants.length > 0 ? (detail.variants[0]?.id ?? null) : null,
        selections,
        qty: 1,
        note: "",
        error: null,
      });
    } catch (err) {
      setError(humanError(err));
    } finally {
      setPanelLoadingId(null);
    }
  };

  // -------------------------------------------------------------------- cart

  const previewSubtotal = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          (line.unit_base +
            line.modifiers.reduce((s, m) => s + m.price_delta * m.qty, 0)) *
            line.qty,
        0,
      ),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((s, l) => s + l.qty, 0), [cart]);

  const changeLineQty = (key: string, qty: number) =>
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, qty) } : l)));
  const removeLine = (key: string) => setCart((prev) => prev.filter((l) => l.key !== key));

  const applyPromo = () => {
    const code = promoInput.trim();
    if (!code) return;
    if (!promoCodes.includes(code)) setPromoCodes((prev) => [...prev, code]);
    setPromoInput("");
  };

  // ---------------------------------------------------------------- checkout

  const checkout = async () => {
    if (cart.length === 0) return;
    const baseInput: CreateOrderInput = {
      type: orderType,
      promotion_codes: promoCodes,
      items: cart.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        qty: l.qty,
        note: l.note,
        modifiers: l.modifiers.map((m) => ({
          modifier_option_id: m.modifier_option_id,
          qty: m.qty,
        })),
      })),
    };
    // client_tx_id stabil per isi checkout: percobaan ulang & jalur
    // offline merujuk checkout yang sama, bukan order baru.
    const signature = JSON.stringify(baseInput);
    const key = keyFor("order", signature);
    const input: CreateOrderInput = {
      ...baseInput,
      client_tx_id: keyFor("txid", signature),
    };
    setCreating(true);
    setError(null);
    setSyncNotice(null);
    try {
      const order = await createOrder(input, key);
      setCreatedOrder(order);
      setPayResult(null);
      setOrderSettled(order.payment_status === "paid");
      setPayMethod("cash");
      setCashReceived("");
      setReferenceNo("");
      setStage("paying");
      setSheetOpen(true);
    } catch (err) {
      if (isApiError(err) && err.code === "NETWORK_ERROR") {
        // Gagal JARINGAN (server tidak menjawab), bukan penolakan server:
        // tawarkan menyimpan checkout ke outbox offline.
        setOfflinePayMethod("cash");
        setOfflineCash(formatRpInput(previewSubtotal));
        setOfflinePrompt({
          input,
          idempotencyKey: key,
          previewTotal: previewSubtotal,
          itemCount: cartCount,
          itemSummary: cart.map((l) => `${l.qty}× ${l.product_name}`).join(", "),
        });
      } else {
        setError(humanError(err));
        if (isApiError(err) && err.code === "SHIFT_NOT_OPEN") void loadShift();
      }
    } finally {
      setCreating(false);
    }
  };

  const remaining = createdOrder
    ? Math.max(0, createdOrder.grand_total - createdOrder.paid_total)
    : 0;

  const pay = async () => {
    if (!createdOrder) return;
    const amount = payMethod === "cash" ? parseRpInput(cashReceived) : remaining;
    const input = {
      method: payMethod,
      amount,
      reference_no: payMethod !== "cash" && referenceNo.trim() ? referenceNo.trim() : null,
    };
    const key = keyFor("pay", JSON.stringify({ order: createdOrder.id, ...input }));
    setPaying(true);
    setError(null);
    setSyncNotice(null);
    try {
      const result = await payOrder(createdOrder.id, input, key);
      setPayResult(result);
      if (result.payment.status === "settled") {
        setOrderSettled(true);
        const fresh = await getOrderDetail(createdOrder.id).catch(() => null);
        if (fresh) setCreatedOrder(fresh);
      }
    } catch (err) {
      if (isApiError(err) && err.code === "NETWORK_ERROR") {
        // Pembayaran gagal terkirim karena jaringan: antrekan sebagai
        // event pembayaran offline untuk order yang SUDAH ada di server.
        try {
          addOutboxEntry({
            id: newIdempotencyKey(),
            kind: "payment",
            client_tx_id: createdOrder.client_tx_id ?? "",
            payment_client_tx_id: newIdempotencyKey(),
            idempotency_key: key,
            order_input: null,
            order_id: createdOrder.id,
            order_label: createdOrder.order_no,
            payment: {
              method: input.method,
              amount: input.amount,
              reference_no: input.reference_no ?? null,
            },
            preview_total: input.amount,
            item_count: 0,
            item_summary: `Pembayaran ${paymentMethodLabel(input.method)} ${formatRp(input.amount)} untuk pesanan ${createdOrder.order_no}`,
            created_at: Date.now(),
            status: "queued",
            reject_code: null,
            reject_reason: null,
          });
        } catch (storageError) {
          setError(`Pembayaran belum tersimpan di perangkat. ${humanError(storageError)}`);
          return;
        }
        setSyncNotice(
          `Pembayaran pesanan ${createdOrder.order_no} tercatat di perangkat (belum masuk server) dan akan disinkronkan.`,
        );
        resetTransaction();
      } else {
        setError(humanError(err));
      }
    } finally {
      setPaying(false);
    }
  };

  const confirmPending = async () => {
    if (!payResult) return;
    setConfirming(true);
    setError(null);
    try {
      await confirmPayment(payResult.payment.id);
      setOrderSettled(true);
      if (createdOrder) {
        const fresh = await getOrderDetail(createdOrder.id).catch(() => null);
        if (fresh) setCreatedOrder(fresh);
      }
    } catch (err) {
      setError(humanError(err));
    } finally {
      setConfirming(false);
    }
  };

  const resetTransaction = () => {
    clearKeys();
    setCart([]);
    setPromoCodes([]);
    setPromoInput("");
    setCreatedOrder(null);
    setPayResult(null);
    setOrderSettled(false);
    setStage("cart");
    setSheetOpen(false);
    setError(null);
    setConfirmClear(false);
  };

  // ------------------------------------------------------------- offline

  const saveOfflineCheckout = () => {
    if (!offlinePrompt) return;
    const payment =
      offlinePayMethod === "none"
        ? null
        : {
            method: offlinePayMethod,
            amount:
              offlinePayMethod === "cash"
                ? parseRpInput(offlineCash)
                : offlinePrompt.previewTotal,
            reference_no: null,
          };
    try {
      addOutboxEntry({
        id: offlinePrompt.input.client_tx_id ?? newIdempotencyKey(),
        kind: "checkout",
        client_tx_id: offlinePrompt.input.client_tx_id ?? "",
        payment_client_tx_id: newIdempotencyKey(),
        idempotency_key: offlinePrompt.idempotencyKey,
        order_input: offlinePrompt.input,
        order_id: null,
        order_label: "Checkout offline",
        payment,
        preview_total: offlinePrompt.previewTotal,
        item_count: offlinePrompt.itemCount,
        item_summary: offlinePrompt.itemSummary,
        created_at: Date.now(),
        status: "queued",
        reject_code: null,
        reject_reason: null,
      });
    } catch (storageError) {
      setError(`Checkout belum tersimpan di perangkat. ${humanError(storageError)}`);
      return;
    }
    setOfflinePrompt(null);
    resetTransaction();
    setSyncNotice(
      "Checkout tersimpan di perangkat (belum masuk server). Akan dikirim otomatis saat koneksi kembali, atau tekan Sinkronkan Sekarang.",
    );
  };

  const manualSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    try {
      const summary = await syncOutbox({ includeRejected: true });
      if (summary.networkError) {
        setSyncNotice(
          "Masih belum terhubung ke server. Antrean tetap tersimpan aman di perangkat.",
        );
      } else if (summary.attempted === 0) {
        setSyncNotice("Tidak ada antrean yang perlu dikirim.");
      } else {
        setSyncNotice(
          `Sinkronisasi selesai: ${summary.completed} terkirim ke server` +
            (summary.rejected > 0
              ? `, ${summary.rejected} ditolak server (lihat alasannya di antrean).`
              : "."),
        );
      }
    } catch (err) {
      setSyncNotice(`Sinkronisasi belum berhasil: ${humanError(err)}`);
    } finally {
      setSyncing(false);
      setOutboxEntries(loadOutbox());
    }
  };

  // ------------------------------------------------------------- panel logic

  const togglePanelOption = (group: ModifierGroup, optionId: string) => {
    if (!panel) return;
    setPanel((prev) => {
      if (!prev) return prev;
      const current = prev.selections[group.id] ?? [];
      let next: string[];
      if (group.selection_type === "single") {
        next = [optionId];
      } else if (current.includes(optionId)) {
        next = current.filter((id) => id !== optionId);
      } else {
        if (group.max_select !== null && current.length >= group.max_select) return prev;
        next = [...current, optionId];
      }
      return { ...prev, selections: { ...prev.selections, [group.id]: next }, error: null };
    });
  };

  const panelPreview = useMemo(() => {
    if (!panel) return 0;
    const variant = panel.detail.variants.find((v) => v.id === panel.variantId);
    let unit = panel.detail.base_price + (variant?.price_delta ?? 0);
    for (const group of panel.detail.modifiers) {
      for (const optId of panel.selections[group.id] ?? []) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) unit += opt.price_delta;
      }
    }
    return unit * panel.qty;
  }, [panel]);

  const confirmPanel = () => {
    if (!panel) return;
    const modifiers: CartModifier[] = [];
    for (const group of panel.detail.modifiers) {
      const chosen = panel.selections[group.id] ?? [];
      if (group.is_required && chosen.length === 0) {
        setPanel({ ...panel, error: `Grup "${group.name}" wajib dipilih.` });
        return;
      }
      if (chosen.length < group.min_select) {
        setPanel({
          ...panel,
          error: `Grup "${group.name}" minimal ${group.min_select} pilihan.`,
        });
        return;
      }
      for (const optId of chosen) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) {
          modifiers.push({
            modifier_option_id: opt.id,
            name: opt.name,
            price_delta: opt.price_delta,
            qty: 1,
          });
        }
      }
    }
    addLine(panel.detail, panel.variantId, modifiers, panel.qty, panel.note);
    setPanel(null);
  };

  const outboxSection = (outboxEntries.length > 0 || syncNotice) && (
    <section
      aria-label="Antrean sinkronisasi offline"
      className="border-b border-line bg-warning-bg px-4 py-3 lg:col-span-3"
    >
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 font-display text-h3 font-semibold text-warning">
            <WifiOff size={20} aria-hidden />
            Antrean Offline{outboxEntries.length > 0 ? ` (${outboxEntries.length})` : ""}
          </h2>
          {outboxEntries.length > 0 && (
            <button
              type="button"
              onClick={() => void manualSync()}
              disabled={syncing}
              className="ml-auto flex min-h-[44px] items-center gap-2 rounded-md bg-primary px-4 font-display text-sm font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} aria-hidden />
              {syncing ? "Mengirim…" : "Sinkronkan Sekarang"}
            </button>
          )}
        </div>
        {syncNotice && (
          <p role="status" className="mt-1.5 text-sm font-medium text-ink">
            {syncNotice}
          </p>
        )}
        {outboxEntries.length > 0 && (
          <ul className="mt-2.5 space-y-2">
            {outboxEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-md bg-surface px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {entry.order_label}
                    {entry.status === "rejected" ? (
                      <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-bold text-danger">
                        Ditolak
                      </span>
                    ) : (
                      <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-bold text-warning">
                        Menunggu sinkronisasi
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-secondary">{entry.item_summary}</p>
                  <p className="numeric text-xs text-muted">
                    Tercatat {formatDateTime(entry.created_at)} · pratinjau{" "}
                    {formatRp(entry.preview_total)}
                    {entry.payment
                      ? ` · ${paymentMethodLabel(entry.payment.method)} ${formatRp(entry.payment.amount)}`
                      : " · tanpa pembayaran"}
                  </p>
                  {entry.status === "queued" && (
                    <p className="text-xs font-medium text-warning">
                      Tercatat di perangkat, belum masuk server.
                    </p>
                  )}
                  {entry.status === "rejected" && entry.reject_reason && (
                    <p className="text-xs font-medium text-danger">
                      Alasan server: {entry.reject_reason}. Periksa lalu kirim ulang lewat
                      Sinkronkan Sekarang, atau hapus entri ini.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      removeOutboxEntry(entry.id);
                    } catch (storageError) {
                      setSyncNotice(humanError(storageError));
                    }
                  }}
                  aria-label={`Hapus entri antrean ${entry.order_label}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger-bg"
                >
                  <Trash size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  // ------------------------------------------------------------------- views

  if (shiftLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-muted">Memeriksa status shift…</p>
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-8">
        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
            <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {outboxSection}
        <div className="rounded-lg border border-line bg-surface p-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
            <ShoppingCart size={32} aria-hidden />
          </span>
          <h2 className="mt-4 font-display text-h2 font-bold text-ink">Shift belum dibuka</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-secondary">
            Layar kasir terkunci sampai shift dibuka. Masukkan modal awal di laci untuk mulai
            berjualan.
          </p>
          <div className="mx-auto mt-5 max-w-xs text-left">
            <label htmlFor="opening-cash" className="mb-1.5 block text-sm font-semibold text-ink">
              Modal awal (Rp)
            </label>
            <input
              id="opening-cash"
              inputMode="numeric"
              value={openingCash}
              onChange={(e) => setOpeningCash(formatRpInput(parseRpInput(e.target.value)))}
              placeholder="0"
              className="numeric min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void onOpenShift()}
              disabled={openingBusy}
              className="mt-3 min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {openingBusy ? "Membuka…" : "Buka Shift"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const cartPanel = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:overflow-visible">
      {stage === "cart" ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 font-display text-h3 font-semibold text-ink">
              <ShoppingCart size={20} aria-hidden /> Keranjang
            </h2>
            {cart.length > 0 &&
              (confirmClear ? (
                <span className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-danger">Kosongkan semua?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setCart([]);
                      setConfirmClear(false);
                    }}
                    className="min-h-[36px] rounded-md bg-danger px-2.5 font-semibold text-white"
                  >
                    Ya
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="min-h-[36px] rounded-md border border-line px-2.5 font-semibold text-secondary"
                  >
                    Batal
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-primary-text hover:bg-subtle"
                >
                  <Trash size={16} aria-hidden /> Kosongkan
                </button>
              ))}
          </div>

          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-10 text-center lg:flex-1">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-subtle text-muted">
                <ShoppingBasket size={28} aria-hidden />
              </span>
              <p className="mt-3 font-display text-h3 font-semibold text-ink">Keranjang masih kosong</p>
              <p className="mt-1 text-sm text-secondary">Pilih produk untuk memulai pesanan.</p>
            </div>
          ) : (
            <ul className="shrink-0 divide-y divide-line px-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto" aria-label="Isi keranjang">
              {cart.map((line) => {
                const linePreview =
                  (line.unit_base +
                    line.modifiers.reduce((s, m) => s + m.price_delta * m.qty, 0)) *
                  line.qty;
                return (
                  <li key={line.key} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-display text-base font-semibold text-ink">
                          {line.product_name}
                          {line.variant_name && (
                            <span className="text-secondary"> · {line.variant_name}</span>
                          )}
                        </p>
                        {line.modifiers.length > 0 && (
                          <p className="text-xs text-muted">
                            {line.modifiers.map((m) => m.name).join(", ")}
                          </p>
                        )}
                        {line.note && (
                          <p className="text-xs italic text-muted">“{line.note}”</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Hapus ${line.product_name} dari keranjang`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger-bg"
                      >
                        <Trash size={18} aria-hidden />
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <QtyStepper
                        value={line.qty}
                        onChange={(q) => changeLineQty(line.key, q)}
                        label={`Jumlah ${line.product_name}`}
                      />
                      <span className="numeric font-display text-price font-bold text-ink">
                        {formatRp(linePreview)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="shrink-0 border-t border-line px-4 py-3">
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Jenis pesanan">
              {(
                [
                  ["dine_in", "Makan di Tempat"],
                  ["takeaway", "Bawa Pulang"],
                  ["online", "Online"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={orderType === value}
                  onClick={() => setOrderType(value)}
                  className={`min-h-[40px] flex-1 rounded-full border px-2 text-sm font-semibold ${
                    orderType === value
                      ? "border-primary bg-primary-soft text-primary-text"
                      : "border-line bg-surface text-secondary hover:bg-subtle"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <label htmlFor="promo" className="mb-1.5 block text-sm font-semibold text-ink">
              Kode Promo
            </label>
            <div className="flex gap-2">
              <input
                id="promo"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder="Kode promo, mis. HEMAT10"
                className="min-h-[44px] min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-primary"
              />
              <button
                type="button"
                onClick={applyPromo}
                disabled={!promoInput.trim()}
                className="min-h-[44px] shrink-0 rounded-md border border-line px-3 text-sm font-semibold text-primary-text hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pakai
              </button>
            </div>
            {promoCodes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {promoCodes.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-text">
                    {code}
                    <button
                      type="button"
                      aria-label={`Hapus promo ${code}`}
                      onClick={() => setPromoCodes((prev) => prev.filter((p) => p !== code))}
                      className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-surface"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted">
              Promo diperiksa & dihitung server saat pesanan dibuat.
            </p>

            <div aria-live="polite" className="numeric mt-3 flex items-baseline justify-between">
              <span className="text-sm text-secondary">Perkiraan subtotal</span>
              <span className="font-display text-price-lg font-extrabold text-ink">
                {formatRp(previewSubtotal)}
              </span>
            </div>
            <p className="text-xs text-muted">
              Perkiraan di perangkat ini — total resmi dihitung server setelah pesanan dibuat.
            </p>
          </div>
          <div className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-surface px-4 py-3 lg:static lg:border-t-0 lg:pt-0">
            <button
              type="button"
              onClick={() => void checkout()}
              disabled={cart.length === 0 || creating}
              className="min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? "Membuat Pesanan…" : "Buat Pesanan & Bayar"}
            </button>
          </div>
        </>
      ) : createdOrder ? (
        <div className="shrink-0 px-4 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <p className="text-sm text-secondary">Nomor pesanan</p>
          <p className="numeric font-display text-h1 font-bold text-ink">{createdOrder.order_no}</p>

          <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
            {createdOrder.items.map((item) => (
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

          {error && (
            <p role="alert" className="mt-3 rounded-md bg-danger-bg p-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}

          <dl className="numeric mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between"><dt className="text-secondary">Subtotal</dt><dd className="font-semibold">{formatRp(createdOrder.subtotal)}</dd></div>
            {createdOrder.discount_total > 0 && (
              <div className="flex justify-between"><dt className="text-secondary">Diskon promo</dt><dd className="font-semibold text-success">−{formatRp(createdOrder.discount_total)}</dd></div>
            )}
            {createdOrder.tax_total > 0 && (
              <div className="flex justify-between"><dt className="text-secondary">Pajak</dt><dd className="font-semibold">{formatRp(createdOrder.tax_total)}</dd></div>
            )}
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-semibold">Total (dari server)</dt>
              <dd className="font-display text-price-lg font-extrabold">{formatRp(createdOrder.grand_total)}</dd>
            </div>
            {createdOrder.paid_total > 0 && (
              <div className="flex justify-between"><dt className="text-secondary">Sudah terbayar</dt><dd className="font-semibold">{formatRp(createdOrder.paid_total)}</dd></div>
            )}
          </dl>

          {orderSettled ? (
            <div className="mt-5 rounded-lg bg-success-bg p-4 text-center">
              <CircleCheck size={40} aria-hidden className="mx-auto text-success" />
              <p className="mt-2 font-display text-h2 font-bold text-success">Pembayaran Lunas</p>
              {payResult && payResult.change_amount > 0 && (
                <p className="numeric mt-1 text-sm font-semibold text-ink">
                  Kembalian: {formatRp(payResult.change_amount)}
                </p>
              )}
              <p className="mt-1 text-sm text-secondary">
                Pesanan {createdOrder.order_no} sudah masuk antrean dapur.
              </p>
              <button
                type="button"
                onClick={resetTransaction}
                className="mt-4 min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover"
              >
                Transaksi Baru
              </button>
            </div>
          ) : payResult && payResult.payment.status === "pending" ? (
            <div className="mt-5 rounded-lg bg-warning-bg p-4">
              <p className="font-display text-h3 font-semibold text-warning">
                Menunggu konfirmasi pembayaran
              </p>
              <p className="mt-1 text-sm text-secondary">
                Pembayaran {paymentMethodLabel(payResult.payment.method)}{" "}
                <span className="numeric font-semibold">{formatRp(payResult.payment.amount)}</span>{" "}
                sudah tercatat dan menunggu konfirmasi pemilik/manager sebelum dianggap lunas.
              </p>
              {(user?.role === "owner" || user?.role === "manager") && (
                <button
                  type="button"
                  onClick={() => void confirmPending()}
                  disabled={confirming}
                  className="mt-3 min-h-[48px] w-full rounded-md bg-success px-4 font-display text-base font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {confirming ? "Mengonfirmasi…" : "Konfirmasi Pembayaran"}
                </button>
              )}
              <button
                type="button"
                onClick={resetTransaction}
                className="mt-2 min-h-[44px] w-full rounded-md border border-line bg-surface px-4 text-sm font-semibold text-secondary hover:bg-subtle"
              >
                Transaksi Baru (pesanan tetap tercatat)
              </button>
            </div>
          ) : (
            <div className="mt-5">
              <h3 className="font-display text-h3 font-semibold text-ink">Pembayaran</h3>
              <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Metode pembayaran">
                {(
                  [
                    { value: "cash", label: "Tunai", icon: Banknote },
                    { value: "qris", label: "QRIS", icon: QrCode },
                    { value: "transfer", label: "Transfer", icon: Landmark },
                    { value: "edc", label: "Kartu (EDC)", icon: Wallet },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={payMethod === value}
                    onClick={() => setPayMethod(value)}
                    className={`flex min-h-[52px] items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                      payMethod === value
                        ? "border-2 border-primary bg-primary-soft text-primary-text"
                        : "border-line bg-surface text-secondary hover:bg-subtle"
                    }`}
                  >
                    <Icon size={20} aria-hidden />
                    {label}
                    {payMethod === value && <Check size={16} aria-hidden className="ml-auto" />}
                  </button>
                ))}
              </div>

              {payMethod === "cash" ? (
                <div className="mt-3">
                  <label htmlFor="cash-received" className="mb-1.5 block text-sm font-semibold text-ink">
                    Uang diterima (Rp)
                  </label>
                  <input
                    id="cash-received"
                    inputMode="numeric"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(formatRpInput(parseRpInput(e.target.value)))}
                    placeholder="0"
                    className="numeric min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      { label: "Uang Pas", value: remaining },
                      { label: "Rp20.000", value: 20000 },
                      { label: "Rp50.000", value: 50000 },
                      { label: "Rp100.000", value: 100000 },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setCashReceived(formatRpInput(chip.value))}
                        className="min-h-[40px] rounded-full border border-line px-3 text-sm font-semibold text-secondary hover:bg-subtle"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  {parseRpInput(cashReceived) >= remaining && remaining > 0 && (
                    <p className="numeric mt-2 text-sm font-semibold text-success">
                      Kembalian perkiraan: {formatRp(parseRpInput(cashReceived) - remaining)}{" "}
                      <span className="font-normal text-muted">(resmi dari server setelah bayar)</span>
                    </p>
                  )}
                  {parseRpInput(cashReceived) > 0 && parseRpInput(cashReceived) < remaining && (
                    <p className="mt-2 text-sm font-medium text-danger">
                      Uang diterima kurang dari sisa tagihan {formatRp(remaining)}.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void pay()}
                    disabled={paying || parseRpInput(cashReceived) < remaining}
                    className="mt-3 min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {paying ? "Memproses…" : `Bayar Tunai ${formatRp(remaining)}`}
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="numeric text-sm text-secondary">
                    Jumlah yang dibayar harus pas:{" "}
                    <span className="font-display text-base font-bold text-ink">{formatRp(remaining)}</span>
                  </p>
                  <label htmlFor="ref-no" className="mb-1.5 mt-3 block text-sm font-semibold text-ink">
                    Nomor referensi (opsional)
                  </label>
                  <input
                    id="ref-no"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="No. referensi / bukti transfer"
                    className="min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void pay()}
                    disabled={paying}
                    className="mt-3 min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {paying ? "Memproses…" : `Kirim Pembayaran ${paymentMethodLabel(payMethod)}`}
                  </button>
                  <p className="mt-1.5 text-xs text-muted">
                    Status awal: menunggu konfirmasi pemilik/manager.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={resetTransaction}
                className="mt-3 min-h-[44px] w-full rounded-md px-4 text-sm font-semibold text-primary-text hover:bg-subtle"
              >
                Bayar Nanti — kembali ke transaksi baru
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="pb-20 lg:grid lg:pb-0 lg:h-[calc(100dvh-4rem)] lg:grid-cols-[232px_minmax(0,1fr)_380px]">
      {outboxSection}
      {/* Kategori */}
      <div className="border-b border-line bg-surface lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div
          className="flex flex-wrap gap-2 px-4 py-3 lg:flex-col"
          role="group"
          aria-label="Filter kategori"
        >
          {[{ id: null, name: "Semua" }, ...categories.map((c) => ({ id: c.id as string | null, name: c.name }))].map(
            (cat) => (
              <button
                key={cat.id ?? "semua"}
                type="button"
                aria-pressed={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-semibold lg:rounded-md lg:text-left ${
                  activeCategory === cat.id
                    ? "bg-primary-soft text-primary-text"
                    : "bg-subtle text-secondary hover:text-ink lg:bg-transparent"
                }`}
              >
                {cat.name}
              </button>
            ),
          )}
        </div>
      </div>

      {/* Produk */}
      <section className="min-w-0 px-4 py-4 lg:overflow-y-auto" aria-label="Daftar produk">
        <div className="relative mb-4">
          <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari produk…"
            aria-label="Cari produk"
            className="min-h-[48px] w-full rounded-md border border-line bg-surface pl-10 pr-3 text-base text-ink placeholder:text-muted focus:border-primary"
          />
        </div>

        {error && !offlinePrompt && stage === "cart" && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
            <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {catalogLoading ? (
          <p className="text-sm text-muted">Memuat katalog…</p>
        ) : visibleProducts.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-subtle text-muted">
              <ShoppingBasket size={32} aria-hidden />
            </span>
            <p className="mt-4 font-display text-h2 font-bold text-ink">Tidak ada produk</p>
            <p className="mt-1 max-w-sm text-sm text-secondary">
              Tidak ada produk pada kategori atau pencarian ini.
            </p>
            <button
              type="button"
              onClick={() => void loadCatalog()}
              className="mt-4 min-h-[44px] rounded-md border border-line px-4 text-sm font-semibold text-primary-text hover:bg-subtle"
            >
              Muat Ulang Katalog
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => void onProductClick(product)}
                disabled={panelLoadingId === product.id}
                className="flex flex-col rounded-md border border-line bg-surface p-3 text-left shadow-sm transition-colors hover:border-line-strong disabled:opacity-60"
              >
                <span className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-subtle text-muted">
                  <UtensilsCrossed size={28} aria-hidden />
                </span>
                <span className="mt-2 line-clamp-2 font-display text-h3 font-semibold leading-snug text-ink">
                  {product.name}
                </span>
                <span className="numeric mt-auto pt-1 font-display text-price font-bold text-ink">
                  {formatRp(product.base_price)}
                </span>
                {panelLoadingId === product.id && (
                  <span className="text-xs text-muted">Memuat opsi…</span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Keranjang desktop */}
      <aside
        aria-label="Keranjang dan pembayaran"
        className="hidden min-h-0 flex-col border-l border-line bg-surface lg:flex"
      >
        {cartPanel}
      </aside>

      {/* Bar total HP/tablet */}
      <div
        className="fixed inset-x-0 bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface px-4 py-2.5 shadow-[0_-2px_8px_rgba(15,23,42,0.06)] md:bottom-[env(safe-area-inset-bottom)] md:left-[72px] lg:hidden"
      >
        <div className="flex items-center gap-3">
          <div aria-live="polite" className="min-w-0">
            <p className="numeric text-xs text-muted">{cartCount} item</p>
            <p className="numeric truncate font-display text-price-lg font-extrabold text-ink">
              {stage === "paying" && createdOrder
                ? formatRp(createdOrder.grand_total)
                : formatRp(previewSubtotal)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            disabled={stage === "cart" && cart.length === 0}
            className="ml-auto flex min-h-[48px] items-center gap-2 rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShoppingCart size={20} aria-hidden />
            {stage === "paying" ? "Pembayaran" : "Lihat Keranjang"}
          </button>
        </div>
      </div>

      {/* Sheet keranjang HP/tablet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Keranjang dan pembayaran">
          <div aria-hidden onClick={() => setSheetOpen(false)} className="absolute inset-0 bg-slate-900/50" />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-xl bg-surface pb-[env(safe-area-inset-bottom)]">
            <div className="flex shrink-0 items-center justify-between border-b border-line px-4">
              <span aria-hidden className="h-1.5 w-10 rounded-full bg-line-strong" />
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Tutup keranjang"
                className="grid h-11 w-11 place-items-center rounded-md text-secondary hover:bg-subtle"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            {cartPanel}
          </div>
        </div>
      )}

      {/* Panel opsi produk */}
      {panel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Opsi ${panel.detail.name}`}>
          <button
            type="button"
            aria-label="Tutup panel opsi"
            onClick={() => setPanel(null)}
            className="absolute inset-0 h-full w-full bg-slate-900/50"
          />
          <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-xl bg-surface sm:rounded-lg">
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-display text-h2 font-bold text-ink">{panel.detail.name}</h2>
                <p className="numeric text-sm text-secondary">
                  Harga dasar {formatRp(panel.detail.base_price)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPanel(null)}
                aria-label="Tutup panel opsi"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-subtle"
              >
                <X size={20} aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {panel.error && (
                <div role="alert" className="mb-3 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
                  <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0" />
                  <span>{panel.error}</span>
                </div>
              )}

              {panel.detail.variants.length > 0 && (
                <fieldset className="mb-4">
                  <legend className="mb-2 text-sm font-semibold text-ink">Varian</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Varian">
                    {panel.detail.variants.map((variant) => {
                      const selected = panel.variantId === variant.id;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setPanel({ ...panel, variantId: variant.id })}
                          className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold ${
                            selected
                              ? "border-primary bg-primary-soft text-primary-text"
                              : "border-line bg-surface text-secondary hover:bg-subtle"
                          }`}
                        >
                          {selected && <Check size={16} aria-hidden />}
                          {variant.name}
                          {variant.price_delta !== 0 && (
                            <span className="numeric text-xs">{formatRpDelta(variant.price_delta)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              {panel.detail.modifiers.map((group) => {
                const isSpicy = /pedas/i.test(group.name);
                const chosen = panel.selections[group.id] ?? [];
                return (
                  <fieldset key={group.id} className="mb-4">
                    <legend className="mb-2 text-sm font-semibold text-ink">
                      {group.name}
                      {group.is_required && <span className="text-danger"> *</span>}
                      <span className="ml-1.5 text-xs font-normal text-muted">
                        {group.selection_type === "single" ? "(pilih satu)" : "(boleh banyak)"}
                      </span>
                    </legend>
                    <div
                      className="flex flex-wrap gap-2"
                      role={group.selection_type === "single" ? "radiogroup" : "group"}
                      aria-label={group.name}
                    >
                      {group.options.map((option, idx) => {
                        const selected = chosen.includes(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role={group.selection_type === "single" ? "radio" : undefined}
                            aria-checked={group.selection_type === "single" ? selected : undefined}
                            aria-pressed={group.selection_type === "multiple" ? selected : undefined}
                            onClick={() => togglePanelOption(group, option.id)}
                            className={`flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold ${
                              selected
                                ? "border-primary bg-primary-soft text-primary-text"
                                : "border-line bg-surface text-secondary hover:bg-subtle"
                            }`}
                          >
                            {selected && <Check size={16} aria-hidden />}
                            {isSpicy && idx > 0 && (
                              <span className="flex" aria-hidden>
                                {Array.from({ length: Math.min(idx, 3) }).map((_, i) => (
                                  <Flame key={i} size={14} className="text-primary" />
                                ))}
                              </span>
                            )}
                            {option.name}
                            {option.price_delta !== 0 && (
                              <span className="numeric text-xs">{formatRpDelta(option.price_delta)}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Jumlah</span>
                <QtyStepper
                  value={panel.qty}
                  onChange={(q) => setPanel({ ...panel, qty: q })}
                  label={`Jumlah ${panel.detail.name}`}
                />
              </div>

              <div>
                <label htmlFor="panel-note" className="mb-1.5 block text-sm font-semibold text-ink">
                  Catatan item (opsional)
                </label>
                <input
                  id="panel-note"
                  value={panel.note}
                  onChange={(e) => setPanel({ ...panel, note: e.target.value })}
                  placeholder="Mis. tidak pakai bawang"
                  className="min-h-[44px] w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-primary"
                />
              </div>
            </div>

            <div className="border-t border-line px-5 py-4">
              <button
                type="button"
                onClick={confirmPanel}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover"
              >
                Tambah ke Keranjang · <span className="numeric">{formatRp(panelPreview)}</span>
              </button>
              <p className="mt-1.5 text-center text-xs text-muted">
                Harga pratinjau di perangkat — harga resmi dihitung server saat pesanan dibuat.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dialog simpan checkout offline (koneksi terputus saat checkout) */}
      {offlinePrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Simpan checkout offline">
          <div aria-hidden className="absolute inset-0 bg-slate-900/50" />
          <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface p-5 sm:rounded-lg">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning">
              <WifiOff size={28} aria-hidden />
            </span>
            <h2 className="mt-3 font-display text-h2 font-bold text-ink">
              Koneksi ke server terputus
            </h2>
            <p className="mt-1 text-sm text-secondary">
              Pesanan ini <strong>belum masuk server</strong>. Kamu bisa mencatatnya dulu di
              perangkat ini — statusnya tercatat di perangkat, belum masuk server — dan sistem
              akan mengirimnya otomatis saat koneksi kembali. Total resmi tetap dihitung server
              saat tersinkron; angka di bawah ini pratinjau dari perangkat.
            </p>
            <div className="numeric mt-3 rounded-md bg-subtle px-3 py-2.5 text-sm">
              <p className="font-semibold text-ink">{offlinePrompt.itemSummary}</p>
              <p className="text-secondary">
                {offlinePrompt.itemCount} item · pratinjau {formatRp(offlinePrompt.previewTotal)}
              </p>
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-md bg-danger-bg p-3 text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-semibold text-ink">Pembayaran pelanggan</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Metode pembayaran offline">
                {(
                  [
                    { value: "cash", label: "Tunai", icon: Banknote },
                    { value: "qris", label: "QRIS", icon: QrCode },
                    { value: "transfer", label: "Transfer", icon: Landmark },
                    { value: "edc", label: "Kartu (EDC)", icon: Wallet },
                    { value: "none", label: "Tanpa pembayaran sekarang", icon: X },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={offlinePayMethod === value}
                    onClick={() => setOfflinePayMethod(value)}
                    className={`flex min-h-[52px] items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                      offlinePayMethod === value
                        ? "border-2 border-primary bg-primary-soft text-primary-text"
                        : "border-line bg-surface text-secondary hover:bg-subtle"
                    }`}
                  >
                    <Icon size={20} aria-hidden />
                    {label}
                    {offlinePayMethod === value && <Check size={16} aria-hidden className="ml-auto" />}
                  </button>
                ))}
              </div>
            </fieldset>

            {offlinePayMethod === "cash" && (
              <div className="mt-3">
                <label htmlFor="offline-cash" className="mb-1.5 block text-sm font-semibold text-ink">
                  Uang diterima (Rp)
                </label>
                <input
                  id="offline-cash"
                  inputMode="numeric"
                  value={offlineCash}
                  onChange={(e) => setOfflineCash(formatRpInput(parseRpInput(e.target.value)))}
                  placeholder="0"
                  className="numeric min-h-[48px] w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-primary"
                />
                <p className="mt-1.5 text-xs text-muted">
                  Kembalian dihitung ulang oleh server saat checkout tersinkron.
                </p>
              </div>
            )}
            {offlinePayMethod !== "cash" && offlinePayMethod !== "none" && (
              <p className="mt-3 text-sm text-secondary">
                Nominal yang dicatat adalah pratinjau{" "}
                <span className="numeric font-semibold text-ink">
                  {formatRp(offlinePrompt.previewTotal)}
                </span>
                ; server memeriksa kecocokannya saat sinkronisasi dan pembayaran non-tunai tetap
                menunggu konfirmasi pemilik/manager.
              </p>
            )}

            <button
              type="button"
              onClick={saveOfflineCheckout}
              className="mt-4 min-h-[52px] w-full rounded-md bg-primary px-4 font-display text-base font-bold text-white hover:bg-primary-hover"
            >
              Simpan Checkout di Perangkat
            </button>
            <button
              type="button"
              onClick={() => setOfflinePrompt(null)}
              className="mt-2 min-h-[44px] w-full rounded-md border border-line px-4 text-sm font-semibold text-secondary hover:bg-subtle"
            >
              Batal — tetap di keranjang
            </button>
          </div>
        </div>
      )}

      {/* Tautan bantuan ke halaman pesanan setelah transaksi selesai di HP */}
      {stage === "paying" && (
        <p className="px-4 pb-4 text-center text-xs text-muted lg:hidden">
          Pesanan juga dapat dipantau di halaman{" "}
          <Link to="/pesanan" className="font-semibold text-primary-text underline">
            Pesanan
          </Link>
          .
        </p>
      )}
    </div>
  );
}
