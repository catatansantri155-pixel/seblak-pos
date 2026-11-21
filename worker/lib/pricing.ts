/**
 * Mesin harga Seblak POS — fungsi MURNI (tanpa I/O, tanpa akses DB).
 *
 * Aturan yang diterapkan (docs/g1-brand-dan-aturan-promo.md bagian 4):
 * - Harga selalu dihitung server dari harga dasar + varian + opsi berbayar.
 * - Urutan: promo item (bogo/bundle/free_item) dulu, lalu promo subtotal
 *   (percent/nominal), lalu pajak dari nilai setelah diskon (aturan 4).
 * - Default promo tidak bisa ditumpuk; hanya is_stackable yang boleh bergabung,
 *   maksimal 2 promo per order (aturan 3).
 * - max_discount adalah plafon mutlak per promo; grand_total tidak pernah
 *   negatif (aturan 2).
 * - Promo di luar masa berlaku / tidak aktif / syarat tidak terpenuhi ditolak
 *   VALIDATION_ERROR (aturan 8).
 *
 * Contoh kontrak yang wajib benar:
 *   Seblak base 10000 + bakso 2x2000 + ceker 3000 + telur 4000 = 21000/porsi;
 *   2 porsi = 42000.
 */
import { ApiError } from "./errors";

export interface PricingModifierInput {
  modifier_option_id: string;
  name: string;
  price_delta: number;
  qty: number;
}

export interface PricingLineInput {
  product_id: string;
  name: string;
  qty: number;
  /** base_price produk + price_delta varian (tanpa modifier). */
  unit_base: number;
  modifiers: PricingModifierInput[];
}

export type PromotionType = "percent" | "nominal" | "bogo" | "bundle" | "free_item";

export interface PromotionInput {
  id: string;
  name: string;
  type: PromotionType;
  /** config JSON yang sudah di-parse dari promotions.config. */
  config: Record<string, unknown>;
  is_stackable: boolean;
  max_discount: number | null;
  is_active: boolean;
  starts_at: number | null;
  ends_at: number | null;
}

export interface PricedLine extends PricingLineInput {
  /** unit_base + sum(price_delta opsi * qty opsi). */
  unit_price: number;
  line_subtotal: number;
  /** Diskon promo tingkat item yang teratribusi ke baris ini. */
  line_discount: number;
  line_total: number;
}

export interface AppliedPromotion {
  promotion_id: string;
  name: string;
  type: PromotionType;
  discount_amount: number;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: number;
  item_discount: number;
  subtotal_discount: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  applied_promotions: AppliedPromotion[];
}

function invalidPromo(promo: PromotionInput, reason: string): ApiError {
  return new ApiError("VALIDATION_ERROR", `Promo "${promo.name}" tidak valid: ${reason}`, {
    promotion_id: promo.id,
    reason,
  });
}

function cfgInt(
  promo: PromotionInput,
  cfg: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number; required?: boolean; def?: number } = {},
): number {
  const raw = cfg[key];
  if (raw === undefined || raw === null) {
    if (opts.required) throw invalidPromo(promo, `config.${key} wajib diisi`);
    return opts.def ?? 0;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw invalidPromo(promo, `config.${key} harus bilangan bulat`);
  }
  if (opts.min !== undefined && raw < opts.min) {
    throw invalidPromo(promo, `config.${key} minimal ${opts.min}`);
  }
  if (opts.max !== undefined && raw > opts.max) {
    throw invalidPromo(promo, `config.${key} maksimal ${opts.max}`);
  }
  return raw;
}

function cfgProductId(
  promo: PromotionInput,
  cfg: Record<string, unknown>,
  key: string,
): string {
  const raw = cfg[key];
  if (typeof raw !== "string" || raw.length === 0) {
    throw invalidPromo(promo, `config.${key} wajib berupa id produk`);
  }
  return raw;
}

function capDiscount(promo: PromotionInput, discount: number): number {
  let d = Math.max(0, Math.floor(discount));
  if (promo.max_discount != null) d = Math.min(d, promo.max_discount);
  return d;
}

export function priceOrder(input: {
  lines: PricingLineInput[];
  promotions: PromotionInput[];
  tax_rate_bp: number;
  now: number;
}): PricingResult {
  const { promotions, tax_rate_bp, now } = input;

  // --- harga dasar per baris -------------------------------------------------
  const lines: PricedLine[] = input.lines.map((l) => {
    const optionsTotal = l.modifiers.reduce(
      (sum, m) => sum + m.price_delta * m.qty,
      0,
    );
    const unit_price = l.unit_base + optionsTotal;
    return {
      ...l,
      unit_price,
      line_subtotal: unit_price * l.qty,
      line_discount: 0,
      line_total: unit_price * l.qty,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.line_subtotal, 0);

  // --- validasi promo: masa berlaku & penumpukan ------------------------------
  for (const promo of promotions) {
    if (!promo.is_active) throw invalidPromo(promo, "promo tidak aktif");
    if (promo.starts_at != null && now < promo.starts_at) {
      throw invalidPromo(promo, "promo belum mulai berlaku");
    }
    if (promo.ends_at != null && now > promo.ends_at) {
      throw invalidPromo(promo, "promo sudah berakhir");
    }
  }
  if (promotions.length > 2) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Maksimal 2 promo per order",
      { promotions: "lebih dari 2 promo" },
    );
  }
  if (promotions.length > 1 && promotions.some((p) => !p.is_stackable)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Promo yang tidak bisa ditumpuk tidak boleh digabung dengan promo lain",
      { promotions: "penumpukan tidak diizinkan" },
    );
  }

  const applied: AppliedPromotion[] = [];
  let itemDiscount = 0;
  let subtotalDiscount = 0;

  const lineOfProduct = (productId: string) =>
    lines.filter((l) => l.product_id === productId);
  const qtyOfProduct = (productId: string) =>
    lineOfProduct(productId).reduce((s, l) => s + l.qty, 0);

  // --- tahap 1: promo item (bogo, bundle, free_item) ---------------------------
  for (const promo of promotions) {
    const cfg = promo.config ?? {};
    let discount = 0;
    if (promo.type === "bogo") {
      const productId = cfgProductId(promo, cfg, "product_id");
      const buyQty = cfgInt(promo, cfg, "buy_qty", { required: true, min: 1 });
      const freeQty = cfgInt(promo, cfg, "free_qty", { required: true, min: 1 });
      const target = lineOfProduct(productId)[0];
      if (!target) throw invalidPromo(promo, "produk promo tidak ada di keranjang");
      const groups = Math.floor(qtyOfProduct(productId) / (buyQty + freeQty));
      const freeUnits = groups * freeQty;
      discount = freeUnits * target.unit_price;
      target.line_discount += Math.min(discount, target.line_subtotal - target.line_discount);
    } else if (promo.type === "bundle") {
      const rawItems = cfg["items"];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw invalidPromo(promo, "config.items wajib berisi daftar item paket");
      }
      const bundlePrice = cfgInt(promo, cfg, "bundle_price", { required: true, min: 0 });
      let bundles = Number.POSITIVE_INFINITY;
      let normalPerBundle = 0;
      let firstLine: PricedLine | undefined;
      for (const raw of rawItems) {
        if (typeof raw !== "object" || raw === null) {
          throw invalidPromo(promo, "config.items harus berisi objek {product_id, qty}");
        }
        const item = raw as Record<string, unknown>;
        const pid = cfgProductId(promo, item, "product_id");
        const need = cfgInt(promo, item, "qty", { required: true, min: 1 });
        const line = lineOfProduct(pid)[0];
        if (!line) throw invalidPromo(promo, "item paket tidak ada di keranjang");
        firstLine ??= line;
        bundles = Math.min(bundles, Math.floor(qtyOfProduct(pid) / need));
        normalPerBundle += line.unit_price * need;
      }
      if (!Number.isFinite(bundles) || bundles < 1) {
        throw invalidPromo(promo, "jumlah item tidak cukup untuk satu paket");
      }
      const perBundleDiscount = normalPerBundle - bundlePrice;
      if (perBundleDiscount <= 0) {
        throw invalidPromo(promo, "harga paket tidak lebih murah dari harga normal");
      }
      discount = perBundleDiscount * bundles;
      if (firstLine) {
        firstLine.line_discount += Math.min(
          discount,
          firstLine.line_subtotal - firstLine.line_discount,
        );
      }
    } else if (promo.type === "free_item") {
      const freeProductId = cfgProductId(promo, cfg, "free_product_id");
      const freeQtyCfg = cfgInt(promo, cfg, "qty", { def: 1, min: 1 });
      const minSubtotal = cfgInt(promo, cfg, "min_subtotal", { def: 0, min: 0 });
      if (subtotal < minSubtotal) {
        throw invalidPromo(promo, "subtotal belum memenuhi syarat item gratis");
      }
      const target = lineOfProduct(freeProductId)[0];
      if (!target) throw invalidPromo(promo, "item gratis tidak ada di keranjang");
      const granted = Math.min(freeQtyCfg, target.qty);
      discount = granted * target.unit_price;
      target.line_discount += Math.min(discount, target.line_subtotal - target.line_discount);
    }
    if (promo.type === "bogo" || promo.type === "bundle" || promo.type === "free_item") {
      discount = capDiscount(promo, discount);
      if (discount > 0) {
        applied.push({
          promotion_id: promo.id,
          name: promo.name,
          type: promo.type,
          discount_amount: discount,
        });
        itemDiscount += discount;
      }
    }
  }

  // --- tahap 2: promo subtotal (percent, nominal) ------------------------------
  const baseAfterItem = subtotal - itemDiscount;
  for (const promo of promotions) {
    const cfg = promo.config ?? {};
    let discount = 0;
    if (promo.type === "percent") {
      const percent = cfgInt(promo, cfg, "percent", { required: true, min: 1, max: 100 });
      const scopedProduct =
        typeof cfg["product_id"] === "string" ? (cfg["product_id"] as string) : null;
      const base = scopedProduct
        ? lineOfProduct(scopedProduct).reduce(
            (s, l) => s + (l.line_subtotal - l.line_discount),
            0,
          )
        : baseAfterItem - subtotalDiscount;
      if (scopedProduct && base <= 0) {
        throw invalidPromo(promo, "produk promo tidak ada di keranjang");
      }
      discount = Math.floor((base * percent) / 100);
    } else if (promo.type === "nominal") {
      const amount = cfgInt(promo, cfg, "amount", { required: true, min: 1 });
      const minSubtotal = cfgInt(promo, cfg, "min_subtotal", { def: 0, min: 0 });
      const base = baseAfterItem - subtotalDiscount;
      if (base < minSubtotal) {
        throw invalidPromo(promo, "subtotal belum memenuhi syarat potongan nominal");
      }
      discount = Math.min(amount, base);
    }
    if (promo.type === "percent" || promo.type === "nominal") {
      discount = capDiscount(promo, discount);
      if (discount > 0) {
        applied.push({
          promotion_id: promo.id,
          name: promo.name,
          type: promo.type,
          discount_amount: discount,
        });
        subtotalDiscount += discount;
      }
    }
  }

  // --- total akhir ---------------------------------------------------------------
  let discountTotal = itemDiscount + subtotalDiscount;
  if (discountTotal > subtotal) discountTotal = subtotal; // aturan 2: tidak negatif
  const taxable = subtotal - discountTotal;
  const taxTotal = Math.floor((taxable * tax_rate_bp) / 10_000);
  const grandTotal = taxable + taxTotal;

  for (const l of lines) l.line_total = l.line_subtotal - l.line_discount;

  return {
    lines,
    subtotal,
    item_discount: itemDiscount,
    subtotal_discount: subtotalDiscount,
    discount_total: discountTotal,
    tax_total: taxTotal,
    grand_total: grandTotal,
    applied_promotions: applied,
  };
}
