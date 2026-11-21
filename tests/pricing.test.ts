/**
 * Test mesin harga murni (worker/lib/pricing.ts):
 * - contoh kontrak yang wajib benar (21.000/porsi, 42.000 untuk 2 porsi),
 * - contoh hitung dokumen promo (percent 10% & plafon max_discount),
 * - bogo, nominal bersyarat, pajak setelah diskon,
 * - promo tidak valid (kedaluwarsa, penumpukan terlarang, syarat tak terpenuhi).
 */
import { describe, expect, it } from "vitest";
import {
  priceOrder,
  type PricingLineInput,
  type PromotionInput,
} from "../worker/lib/pricing";
import { ApiError } from "../worker/lib/errors";

const NOW = 1_763_500_000_000;

function promo(partial: Partial<PromotionInput>): PromotionInput {
  return {
    id: "promo-1",
    name: "Promo Uji",
    type: "percent",
    config: {},
    is_stackable: false,
    max_discount: null,
    is_active: true,
    starts_at: null,
    ends_at: null,
    ...partial,
  };
}

const seblakLine = (qty: number): PricingLineInput => ({
  product_id: "seblak-original",
  name: "Seblak Original",
  qty,
  unit_base: 10_000,
  modifiers: [
    { modifier_option_id: "bakso", name: "Bakso", price_delta: 2_000, qty: 2 },
    { modifier_option_id: "ceker", name: "Ceker", price_delta: 3_000, qty: 1 },
    { modifier_option_id: "telur", name: "Telur", price_delta: 4_000, qty: 1 },
  ],
});

describe("pricing: contoh kontrak wajib", () => {
  it("satu porsi = 21000 (10000 + 2x2000 + 3000 + 4000)", () => {
    const r = priceOrder({ lines: [seblakLine(1)], promotions: [], tax_rate_bp: 0, now: NOW });
    expect(r.lines[0]?.unit_price).toBe(21_000);
    expect(r.subtotal).toBe(21_000);
    expect(r.grand_total).toBe(21_000);
  });

  it("dua porsi = 42000", () => {
    const r = priceOrder({ lines: [seblakLine(2)], promotions: [], tax_rate_bp: 0, now: NOW });
    expect(r.subtotal).toBe(42_000);
    expect(r.grand_total).toBe(42_000);
  });
});

describe("pricing: promo percent (contoh dokumen brand & promo)", () => {
  const lines: PricingLineInput[] = [
    { product_id: "seblak-komplit", name: "Seblak Komplit", qty: 2, unit_base: 15_000, modifiers: [] },
  ];

  it("percent 10% plafon 5000 -> diskon 3000, total 27000", () => {
    const r = priceOrder({
      lines,
      promotions: [promo({ type: "percent", config: { percent: 10 }, max_discount: 5_000 })],
      tax_rate_bp: 0,
      now: NOW,
    });
    expect(r.subtotal).toBe(30_000);
    expect(r.discount_total).toBe(3_000);
    expect(r.grand_total).toBe(27_000);
  });

  it("percent 50% plafon 5000 -> diskon dipotong menjadi 5000, total 25000", () => {
    const r = priceOrder({
      lines,
      promotions: [promo({ type: "percent", config: { percent: 50 }, max_discount: 5_000 })],
      tax_rate_bp: 0,
      now: NOW,
    });
    expect(r.discount_total).toBe(5_000);
    expect(r.grand_total).toBe(25_000);
  });
});

describe("pricing: promo item & nominal", () => {
  it("bogo beli 2 gratis 1 untuk 3 item -> diskon sebesar 1 unit", () => {
    const r = priceOrder({
      lines: [{ product_id: "es-teh", name: "Es Teh", qty: 3, unit_base: 5_000, modifiers: [] }],
      promotions: [
        promo({ type: "bogo", config: { product_id: "es-teh", buy_qty: 2, free_qty: 1 } }),
      ],
      tax_rate_bp: 0,
      now: NOW,
    });
    expect(r.item_discount).toBe(5_000);
    expect(r.grand_total).toBe(10_000);
  });

  it("nominal terpotong sampai sisa tagihan (grand_total tidak negatif)", () => {
    const r = priceOrder({
      lines: [{ product_id: "es-teh", name: "Es Teh", qty: 1, unit_base: 5_000, modifiers: [] }],
      promotions: [promo({ type: "nominal", config: { amount: 99_000 } })],
      tax_rate_bp: 0,
      now: NOW,
    });
    expect(r.discount_total).toBe(5_000);
    expect(r.grand_total).toBe(0);
  });

  it("pajak dihitung setelah diskon", () => {
    const r = priceOrder({
      lines: [{ product_id: "x", name: "X", qty: 1, unit_base: 20_000, modifiers: [] }],
      promotions: [promo({ type: "percent", config: { percent: 50 } })],
      tax_rate_bp: 1_000, // 10%
      now: NOW,
    });
    expect(r.discount_total).toBe(10_000);
    expect(r.tax_total).toBe(1_000);
    expect(r.grand_total).toBe(11_000);
  });
});

describe("pricing: promo tidak valid ditolak VALIDATION_ERROR", () => {
  const lines: PricingLineInput[] = [
    { product_id: "es-teh", name: "Es Teh", qty: 1, unit_base: 5_000, modifiers: [] },
  ];

  it("promo kedaluwarsa", () => {
    expect(() =>
      priceOrder({
        lines,
        promotions: [promo({ type: "percent", config: { percent: 10 }, ends_at: NOW - 1 })],
        tax_rate_bp: 0,
        now: NOW,
      }),
    ).toThrowError(ApiError);
  });

  it("dua promo non-stackable tidak boleh digabung", () => {
    expect(() =>
      priceOrder({
        lines,
        promotions: [
          promo({ id: "p1", type: "percent", config: { percent: 10 } }),
          promo({ id: "p2", type: "nominal", config: { amount: 1_000 } }),
        ],
        tax_rate_bp: 0,
        now: NOW,
      }),
    ).toThrowError(ApiError);
  });

  it("nominal dengan min_subtotal tidak terpenuhi", () => {
    expect(() =>
      priceOrder({
        lines,
        promotions: [promo({ type: "nominal", config: { amount: 1_000, min_subtotal: 50_000 } })],
        tax_rate_bp: 0,
        now: NOW,
      }),
    ).toThrowError(ApiError);
  });

  it("free_item tanpa item gratis di keranjang", () => {
    expect(() =>
      priceOrder({
        lines,
        promotions: [promo({ type: "free_item", config: { free_product_id: "tidak-ada" } })],
        tax_rate_bp: 0,
        now: NOW,
      }),
    ).toThrowError(ApiError);
  });
});
