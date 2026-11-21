/**
 * Skema Drizzle untuk Cloudflare D1 (SQLite) — cermin persis migrasi
 * migrations/0001_identitas.sql s.d. 0009_g4_operasi.sql (kontrak G1a;
 * 0008 menambah tabel sessions, kolom orders.payment_status/kitchen_status,
 * status payments 'pending', dan kolom payments.change_amount untuk G3;
 * 0009 menambah promotions.code + indeks unik parsialnya dan
 * products.min_stock untuk G4).
 *
 * Konvensi G1a:
 * - uang selalu INTEGER minor unit (Rupiah),
 * - waktu selalu INTEGER epoch milidetik (UTC),
 * - kolom standar: id, outlet_id, created_at, updated_at, deleted_at, version,
 *   kecuali tabel jurnal murni (cash_movements, stock_movements, audit_logs,
 *   sync_events, idempotency_keys) yang tanpa updated_at/deleted_at/version,
 * - boolean disimpan INTEGER 0/1 (mode "boolean" di sisi Drizzle).
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------- 0001 identitas

export const outlets = sqliteTable("outlets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  currency: text("currency").notNull().default("IDR"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
  version: integer("version").notNull().default(1),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", {
      enum: ["owner", "manager", "cashier", "kitchen"],
    })
      .notNull()
      .default("cashier"),
    pinHash: text("pin_hash"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("users_outlet_email_unique").on(t.outletId, t.email),
    index("idx_users_outlet").on(t.outletId),
  ],
);

// ------------------------------------------------------------------ 0002 katalog

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    color: text("color"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_categories_outlet").on(t.outletId)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    categoryId: text("category_id").references(() => categories.id),
    name: text("name").notNull(),
    sku: text("sku"),
    basePrice: integer("base_price").notNull().default(0),
    costPrice: integer("cost_price").notNull().default(0),
    isStockTracked: integer("is_stock_tracked", { mode: "boolean" })
      .notNull()
      .default(false),
    minStock: integer("min_stock").notNull().default(0),
    imageKey: text("image_key"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("products_outlet_sku_unique").on(t.outletId, t.sku),
    index("idx_products_outlet").on(t.outletId),
    index("idx_products_category").on(t.categoryId),
  ],
);

export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(),
    priceDelta: integer("price_delta").notNull().default(0),
    skuSuffix: text("sku_suffix"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_variants_product").on(t.productId)],
);

export const modifiers = sqliteTable(
  "modifiers",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    selectionType: text("selection_type", { enum: ["single", "multiple"] })
      .notNull()
      .default("single"),
    isRequired: integer("is_required", { mode: "boolean" })
      .notNull()
      .default(false),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_modifiers_outlet").on(t.outletId)],
);

export const modifierOptions = sqliteTable(
  "modifier_options",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    modifierId: text("modifier_id")
      .notNull()
      .references(() => modifiers.id),
    name: text("name").notNull(),
    priceDelta: integer("price_delta").notNull().default(0),
    stockProductId: text("stock_product_id").references(() => products.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_modifier_options_modifier").on(t.modifierId)],
);

export const productModifiers = sqliteTable(
  "product_modifiers",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    modifierId: text("modifier_id")
      .notNull()
      .references(() => modifiers.id),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("product_modifiers_pair_unique").on(t.productId, t.modifierId),
    index("idx_product_modifiers_product").on(t.productId),
  ],
);

// -------------------------------------------------------------------- 0003 order

export const tables = sqliteTable(
  "tables",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    area: text("area"),
    capacity: integer("capacity").notNull().default(1),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_tables_outlet").on(t.outletId)],
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    tableId: text("table_id").references(() => tables.id),
    orderNo: text("order_no").notNull(),
    type: text("type", { enum: ["dine_in", "takeaway", "online"] })
      .notNull()
      .default("dine_in"),
    status: text("status", {
      enum: ["open", "paid", "completed", "void"],
    })
      .notNull()
      .default("open"),
    // Kolom terpisah dari migrasi 0008: status pembayaran & status dapur
    // tidak menimpa status order.
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "partial", "paid"],
    })
      .notNull()
      .default("unpaid"),
    kitchenStatus: text("kitchen_status", {
      enum: ["queued", "cooking", "done"],
    })
      .notNull()
      .default("queued"),
    cashierId: text("cashier_id").references(() => users.id),
    // Referensi ke cash_shifts (0004) dinyatakan sebagai teks biasa di sini
    // untuk menghindari dependensi melingkar antar-definisi tabel; FK fisik
    // ada di migrasi 0003 sesuai urutan G1a.
    shiftId: text("shift_id"),
    subtotal: integer("subtotal").notNull().default(0),
    discountTotal: integer("discount_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    grandTotal: integer("grand_total").notNull().default(0),
    clientTxId: text("client_tx_id"),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("orders_outlet_no_unique").on(t.outletId, t.orderNo),
    index("idx_orders_outlet_created").on(t.outletId, t.createdAt),
    index("idx_orders_shift").on(t.shiftId),
    uniqueIndex("idx_orders_client_tx").on(t.outletId, t.clientTxId),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    productId: text("product_id").references(() => products.id),
    variantId: text("variant_id").references(() => productVariants.id),
    qty: integer("qty").notNull().default(1),
    unitPrice: integer("unit_price").notNull().default(0),
    lineDiscount: integer("line_discount").notNull().default(0),
    lineTotal: integer("line_total").notNull().default(0),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_order_items_order").on(t.orderId)],
);

export const orderItemModifiers = sqliteTable(
  "order_item_modifiers",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    modifierOptionId: text("modifier_option_id").references(
      () => modifierOptions.id,
    ),
    nameSnapshot: text("name_snapshot"),
    priceDelta: integer("price_delta").notNull().default(0),
    qty: integer("qty").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_order_item_modifiers_item").on(t.orderItemId)],
);

// ------------------------------------------------------- 0004 pembayaran & shift

export const cashShifts = sqliteTable(
  "cash_shifts",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    cashierId: text("cashier_id").references(() => users.id),
    openedAt: integer("opened_at").notNull(),
    closedAt: integer("closed_at"),
    openingCash: integer("opening_cash").notNull().default(0),
    expectedCash: integer("expected_cash"),
    countedCash: integer("counted_cash"),
    difference: integer("difference"),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_cash_shifts_outlet").on(t.outletId),
    index("idx_cash_shifts_cashier").on(t.cashierId),
  ],
);

export const cashMovements = sqliteTable(
  "cash_movements",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    shiftId: text("shift_id")
      .notNull()
      .references(() => cashShifts.id),
    type: text("type", { enum: ["in", "out", "adjustment"] }).notNull(),
    amount: integer("amount").notNull().default(0),
    reason: text("reason"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_cash_movements_shift").on(t.shiftId)],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    orderId: text("order_id").references(() => orders.id),
    shiftId: text("shift_id").references(() => cashShifts.id),
    method: text("method", {
      enum: ["cash", "qris", "edc", "transfer"],
    }).notNull(),
    amount: integer("amount").notNull().default(0),
    changeAmount: integer("change_amount").notNull().default(0),
    status: text("status", {
      enum: ["pending", "settled", "void", "refunded"],
    })
      .notNull()
      .default("settled"),
    referenceNo: text("reference_no"),
    clientTxId: text("client_tx_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_payments_outlet").on(t.outletId),
    index("idx_payments_order").on(t.orderId),
    index("idx_payments_shift").on(t.shiftId),
    uniqueIndex("idx_payments_client_tx").on(t.outletId, t.clientTxId),
  ],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    amount: integer("amount").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_allocations_payment").on(t.paymentId),
    index("idx_allocations_order").on(t.orderId),
  ],
);

// --------------------------------------------------------------- 0005 inventaris

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    phone: text("phone"),
    address: text("address"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_suppliers_outlet").on(t.outletId)],
);

export const stockBatches = sqliteTable(
  "stock_batches",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    supplierId: text("supplier_id").references(() => suppliers.id),
    qtyIn: integer("qty_in").notNull().default(0),
    qtyRemaining: integer("qty_remaining").notNull().default(0),
    unitCost: integer("unit_cost").notNull().default(0),
    receivedAt: integer("received_at").notNull(),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_stock_batches_product").on(t.outletId, t.productId)],
);

export const stockMovements = sqliteTable(
  "stock_movements",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    batchId: text("batch_id").references(() => stockBatches.id),
    type: text("type", {
      enum: ["purchase", "sale", "adjustment", "waste", "return"],
    }).notNull(),
    qtyDelta: integer("qty_delta").notNull().default(0),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_stock_movements_lookup").on(t.outletId, t.productId, t.createdAt),
  ],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    supplierId: text("supplier_id").references(() => suppliers.id),
    poNo: text("po_no"),
    status: text("status", {
      enum: ["draft", "ordered", "received", "cancelled"],
    })
      .notNull()
      .default("draft"),
    totalCost: integer("total_cost").notNull().default(0),
    orderedAt: integer("ordered_at"),
    receivedAt: integer("received_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_purchase_orders_outlet").on(t.outletId)],
);

export const purchaseOrderItems = sqliteTable(
  "purchase_order_items",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    purchaseOrderId: text("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    productId: text("product_id").references(() => products.id),
    qty: integer("qty").notNull().default(0),
    unitCost: integer("unit_cost").notNull().default(0),
    qtyReceived: integer("qty_received").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_po_items_po").on(t.purchaseOrderId)],
);

// -------------------------------------------------------------------- 0006 promo

export const promotions = sqliteTable(
  "promotions",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    name: text("name").notNull(),
    code: text("code"),
    type: text("type", {
      enum: ["percent", "nominal", "bogo", "bundle", "free_item"],
    }).notNull(),
    config: text("config"),
    startsAt: integer("starts_at"),
    endsAt: integer("ends_at"),
    isStackable: integer("is_stackable", { mode: "boolean" })
      .notNull()
      .default(false),
    maxDiscount: integer("max_discount"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_promotions_outlet").on(t.outletId),
    uniqueIndex("idx_promotions_outlet_code").on(t.outletId, t.code),
  ],
);

export const promotionUsages = sqliteTable(
  "promotion_usages",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    discountAmount: integer("discount_amount").notNull().default(0),
    appliedAt: integer("applied_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_promotion_usages_order").on(t.orderId),
    index("idx_promotion_usages_promotion").on(t.promotionId),
  ],
);

// ------------------------------------------------------------------- 0007 sistem

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_audit_logs_outlet_created").on(t.outletId, t.createdAt),
    index("idx_audit_logs_entity").on(t.entity, t.entityId),
  ],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    key: text("key").notNull(),
    requestHash: text("request_hash"),
    responseJson: text("response_json"),
    statusCode: integer("status_code"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("idempotency_keys_outlet_key_unique").on(t.outletId, t.key)],
);

export const syncEvents = sqliteTable(
  "sync_events",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    clientTxId: text("client_tx_id").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    payloadJson: text("payload_json"),
    status: text("status", { enum: ["pending", "applied", "conflict"] })
      .notNull()
      .default("pending"),
    receivedAt: integer("received_at").notNull(),
    appliedAt: integer("applied_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("sync_events_outlet_tx_unique").on(t.outletId, t.clientTxId),
    index("idx_sync_events_outlet_status").on(t.outletId, t.status),
  ],
);

// ---------------------------------------------------------------- 0008 sesi

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    lastSeenAt: integer("last_seen_at"),
  },
  (t) => [
    index("idx_sessions_token").on(t.tokenHash),
    index("idx_sessions_user").on(t.userId),
  ],
);
