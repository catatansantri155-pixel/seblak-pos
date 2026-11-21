/**
 * Klien API Seblak POS (frontend) — berbicara ke Worker lewat /api/v1.
 *
 * Semua respons memakai envelope G1b:
 *   sukses : { data, meta: { request_id, server_time [, pagination] } }
 *   error  : { error: { code, message, details }, meta: { request_id } }
 * Sukses -> kembalikan `data`; error -> lempar ApiError berisi code & message
 * persis dari server agar halaman bisa memetakannya ke kalimat manusiawi.
 */

export type Role = "owner" | "manager" | "cashier" | "kitchen";

export interface User {
  id: string;
  outlet_id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginResult {
  token: string;
  expires_at: number;
  user: User;
}

export interface Category {
  id: string;
  outlet_id: string;
  name: string;
  sort_order: number;
  color: string | null;
}

export interface Product {
  id: string;
  outlet_id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  base_price: number;
  cost_price: number;
  is_stock_tracked: boolean;
  image_key: string | null;
  is_active: boolean;
}

export interface Variant {
  id: string;
  name: string;
  price_delta: number;
  sku_suffix: string | null;
}

export interface ModifierOption {
  id: string;
  name: string;
  price_delta: number;
  stock_product_id: string | null;
}

export interface ModifierGroup {
  id: string;
  name: string;
  selection_type: "single" | "multiple";
  is_required: boolean;
  min_select: number;
  max_select: number | null;
  options: ModifierOption[];
}

export interface ProductDetail extends Product {
  variants: Variant[];
  modifiers: ModifierGroup[];
}

export interface Shift {
  id: string;
  outlet_id: string;
  cashier_id: string | null;
  opened_at: number;
  closed_at: number | null;
  opening_cash: number;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  status: string;
}

export interface CloseShiftResult extends Shift {
  cash_sales_total: number;
  cash_movements_total: number;
}

export interface Order {
  id: string;
  outlet_id: string;
  table_id: string | null;
  order_no: string;
  type: string;
  status: string;
  payment_status: string;
  kitchen_status: string;
  cashier_id: string | null;
  shift_id: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  client_tx_id: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrderItemModifier {
  modifier_option_id: string | null;
  name: string | null;
  price_delta: number;
  qty: number;
}

export interface OrderItem {
  id: string;
  product_id: string | null;
  product_name: string | null;
  variant_id: string | null;
  qty: number;
  unit_price: number;
  line_discount: number;
  line_total: number;
  note: string | null;
  modifiers: OrderItemModifier[];
}

export interface OrderPayment {
  id: string;
  method: string;
  amount: number;
  change_amount: number;
  status: string;
  reference_no: string | null;
  created_at: number;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  promotions: { promotion_id: string; discount_amount: number }[];
  payments: OrderPayment[];
  paid_total: number;
}

export interface CreateOrderItemModifier {
  modifier_option_id: string;
  qty: number;
}

export interface CreateOrderItem {
  product_id: string;
  variant_id?: string | null;
  qty: number;
  note?: string | null;
  modifiers: CreateOrderItemModifier[];
}

export interface CreateOrderInput {
  type?: "dine_in" | "takeaway" | "online";
  table_id?: string | null;
  note?: string | null;
  promotion_ids?: string[];
  /** Kode promo (G4a): diterjemahkan server ke promo aktif outlet. */
  promotion_codes?: string[];
  /** Idempotensi tingkat klien untuk checkout offline (G1b bagian 3). */
  client_tx_id?: string | null;
  items: CreateOrderItem[];
}

export type PaymentMethod = "cash" | "qris" | "edc" | "transfer";

export interface Payment {
  id: string;
  outlet_id: string;
  order_id: string | null;
  shift_id: string | null;
  method: string;
  amount: number;
  change_amount: number;
  status: string;
  reference_no: string | null;
  created_at: number;
}

export interface PayOrderInput {
  method: PaymentMethod;
  amount: number;
  reference_no?: string | null;
}

export interface PayOrderResult {
  payment: Payment;
  order_id: string;
  applied_amount: number;
  change_amount: number;
  payment_status: string;
  order_status: string;
}

export interface ConfirmPaymentResult {
  payment: Payment;
  order: { payment_status: string; status: string } | null;
}

export interface KitchenItem {
  id: string;
  product_id: string | null;
  product_name: string | null;
  qty: number;
  note: string | null;
  modifiers: { name: string | null; qty: number }[];
}

export interface KitchenOrder extends Order {
  items: KitchenItem[];
}

// --------------------------------------------------------------------- error

/** Error dari envelope G1b (atau kegagalan jaringan: code "NETWORK_ERROR"). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

// --------------------------------------------------------------------- token

const TOKEN_KEY = "seblakpos.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Penyimpanan tidak tersedia (mode privat dsb.): sesi hanya di memori.
  }
}

// ------------------------------------------------------------------ transport

interface SuccessEnvelope<T> {
  data: T;
  meta: { request_id: string; server_time: string; pagination?: { page: number; per_page: number; total: number } };
}

async function rawRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<SuccessEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.",
      0,
    );
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok || json === null || typeof json !== "object" || "error" in json) {
    const errBody =
      json !== null && typeof json === "object" && "error" in json
        ? (json as { error: { code?: string; message?: string; details?: unknown } }).error
        : undefined;
    throw new ApiError(
      errBody?.code ?? "INTERNAL_ERROR",
      errBody?.message ?? "Terjadi kesalahan pada server.",
      res.status,
      errBody?.details,
    );
  }
  return json as SuccessEnvelope<T>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const env = await rawRequest<T>(path, init);
  return env.data;
}

export interface Page<T> {
  items: T[];
  total: number;
}

async function requestPage<T>(path: string): Promise<Page<T>> {
  const env = await rawRequest<T[]>(path);
  return { items: env.data, total: env.meta.pagination?.total ?? env.data.length };
}

const jsonBody = (value: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(value),
});

/** Kunci idempotensi baru (UUID) untuk satu checkout/pembayaran. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ------------------------------------------------------------------ endpoints

export function login(input: {
  email: string;
  password: string;
  outlet_id?: string;
}): Promise<LoginResult> {
  return request<LoginResult>("/auth/login", jsonBody(input));
}

export function logout(): Promise<{ logged_out: boolean }> {
  return request<{ logged_out: boolean }>("/auth/logout", { method: "POST" });
}

export function me(): Promise<User> {
  return request<User>("/auth/me");
}

export function listCategories(): Promise<Page<Category>> {
  return requestPage<Category>("/categories?per_page=100");
}

export function listProducts(params?: {
  category_id?: string;
  q?: string;
}): Promise<Page<Product>> {
  const qs = new URLSearchParams({ is_active: "true", per_page: "200" });
  if (params?.category_id) qs.set("category_id", params.category_id);
  if (params?.q) qs.set("q", params.q);
  return requestPage<Product>(`/products?${qs.toString()}`);
}

export function getProductDetail(id: string): Promise<ProductDetail> {
  return request<ProductDetail>(`/products/${encodeURIComponent(id)}`);
}

export function listModifiers(): Promise<ModifierGroup[]> {
  return request<ModifierGroup[]>("/modifiers");
}

export function openShift(opening_cash: number): Promise<Shift> {
  return request<Shift>("/shifts/open", jsonBody({ opening_cash }));
}

export function currentShift(): Promise<Shift> {
  return request<Shift>("/shifts/current");
}

export function closeShift(id: string, counted_cash: number): Promise<CloseShiftResult> {
  return request<CloseShiftResult>(
    `/shifts/${encodeURIComponent(id)}/close`,
    jsonBody({ counted_cash }),
  );
}

export function createOrder(
  input: CreateOrderInput,
  idempotencyKey: string,
): Promise<OrderDetail> {
  return request<OrderDetail>("/orders", {
    ...jsonBody(input),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function payOrder(
  orderId: string,
  input: PayOrderInput,
  idempotencyKey: string,
): Promise<PayOrderResult> {
  return request<PayOrderResult>(`/orders/${encodeURIComponent(orderId)}/payments`, {
    ...jsonBody(input),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function confirmPayment(paymentId: string): Promise<ConfirmPaymentResult> {
  return request<ConfirmPaymentResult>(
    `/payments/${encodeURIComponent(paymentId)}/confirm`,
    { method: "POST" },
  );
}

export function kitchenQueue(): Promise<KitchenOrder[]> {
  return request<KitchenOrder[]>("/kitchen/queue");
}

export function kitchenSetStatus(
  orderId: string,
  status: "cooking" | "done",
): Promise<Order> {
  return request<Order>(
    `/kitchen/orders/${encodeURIComponent(orderId)}/status`,
    jsonBody({ status }),
  );
}

export function listOrders(params?: {
  date_from?: number;
  date_to?: number;
  payment_status?: string;
  kitchen_status?: string;
  status?: string;
}): Promise<Page<Order>> {
  const qs = new URLSearchParams({ per_page: "200" });
  if (params?.date_from !== undefined) qs.set("date_from", String(params.date_from));
  if (params?.date_to !== undefined) qs.set("date_to", String(params.date_to));
  if (params?.payment_status) qs.set("payment_status", params.payment_status);
  if (params?.kitchen_status) qs.set("kitchen_status", params.kitchen_status);
  if (params?.status) qs.set("status", params.status);
  return requestPage<Order>(`/orders?${qs.toString()}`);
}

export function getOrderDetail(id: string): Promise<OrderDetail> {
  return request<OrderDetail>(`/orders/${encodeURIComponent(id)}`);
}

export function cancelOrder(id: string): Promise<OrderDetail> {
  return request<OrderDetail>(`/orders/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}

// ------------------------------------------------------------- G4: laporan

export interface ReportPeriod {
  from: number;
  to: number;
  timezone: string;
}

export interface DailyPaymentMethod {
  method: string;
  settled_count: number;
  settled_amount: number;
  pending_count: number;
  pending_amount: number;
  refunded_count: number;
  refunded_amount: number;
  net_collected: number;
}

export interface DailyShiftSummary {
  id: string;
  cashier_id: string | null;
  status: string;
  opened_at: number;
  closed_at: number | null;
  opening_cash: number;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  settled_cash_amount: number;
  orders_count: number;
}

export interface DailyReport {
  period: ReportPeriod & { date: string };
  gross_sales: number;
  discount_total: number;
  refund_total: number;
  refunds_count: number;
  net_sales: number;
  tax_total: number;
  paid_orders_total: number;
  paid_transaction_count: number;
  /** null bila belum ada transaksi lunas (M-07 Lestari: tampilkan "—"). */
  average_order_value: number | null;
  orders_by_status: Record<string, number>;
  orders_by_payment_status: Record<string, number>;
  payment_methods: DailyPaymentMethod[];
  shifts: DailyShiftSummary[];
}

export function dailyReport(date?: string): Promise<DailyReport> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return request<DailyReport>(`/reports/daily${qs}`);
}

export interface ProductReportItem {
  product_id: string | null;
  product_name: string | null;
  category_id: string | null;
  qty_sold: number;
  gross_revenue: number;
  net_item_revenue: number;
  order_count: number;
}

export interface ProductReport {
  period: ReportPeriod;
  items: ProductReportItem[];
}

export function productReport(from: string, to: string): Promise<ProductReport> {
  const qs = new URLSearchParams({ from, to, per_page: "50" });
  return request<ProductReport>(`/reports/products?${qs.toString()}`);
}

export interface CategoryReportItem {
  category_id: string | null;
  category_name: string | null;
  qty_sold: number;
  gross_revenue: number;
  net_item_revenue: number;
  order_count: number;
  product_count: number;
}

export interface CategoryReport {
  period: ReportPeriod;
  items: CategoryReportItem[];
}

export function categoryReport(from: string, to: string): Promise<CategoryReport> {
  const qs = new URLSearchParams({ from, to, per_page: "50" });
  return request<CategoryReport>(`/reports/categories?${qs.toString()}`);
}

export interface ShiftReconciliation {
  opening_cash: number;
  cash_receipts_settled: number;
  cash_refunds: number;
  cash_movements_total: number;
  expected_cash_computed: number;
  counted_cash: number | null;
  difference_computed: number | null;
}

export interface ShiftReport {
  shift: {
    id: string;
    cashier_id: string | null;
    status: string;
    opened_at: number;
    closed_at: number | null;
    opening_cash: number;
    expected_cash: number | null;
    counted_cash: number | null;
    difference: number | null;
  };
  reconciliation: ShiftReconciliation;
  cash_movements: {
    id: string;
    type: string;
    amount: number;
    reason: string | null;
    created_by: string | null;
    created_at: number;
  }[];
  payment_methods_settled: { method: string; count: number; amount: number }[];
  orders: {
    id: string;
    order_no: string;
    status: string;
    payment_status: string;
    kitchen_status: string;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    grand_total: number;
    created_at: number;
  }[];
}

export function shiftReport(id: string): Promise<ShiftReport> {
  return request<ShiftReport>(`/reports/shift/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------- G4: stok

export interface StockBalance {
  product_id: string;
  name: string;
  sku: string | null;
  category_id: string | null;
  balance: number;
  min_stock: number;
  low_stock: boolean;
}

export function stockBalances(): Promise<Page<StockBalance>> {
  return requestPage<StockBalance>("/stock/balances?per_page=200");
}

export interface StockMovement {
  id: string;
  outlet_id: string;
  product_id: string;
  batch_id: string | null;
  type: string;
  qty_delta: number;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: number;
}

export function stockMovements(params?: {
  product_id?: string;
  type?: string;
  per_page?: number;
}): Promise<Page<StockMovement>> {
  const qs = new URLSearchParams({ per_page: String(params?.per_page ?? 20) });
  if (params?.product_id) qs.set("product_id", params.product_id);
  if (params?.type) qs.set("type", params.type);
  return requestPage<StockMovement>(`/stock/movements?${qs.toString()}`);
}

export type StockMovementType = "purchase" | "adjustment" | "waste" | "return";

export interface CreateMovementResult {
  movement: StockMovement;
  balance_before: number;
  balance_after: number;
}

export function createStockMovement(
  input: {
    product_id: string;
    type: StockMovementType;
    qty_delta: number;
    note?: string | null;
  },
  idempotencyKey: string,
): Promise<CreateMovementResult> {
  return request<CreateMovementResult>("/stock/movements", {
    ...jsonBody(input),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

// ------------------------------------------------------------ G4: pengguna

export interface ManagedUser {
  id: string;
  outlet_id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  version: number;
}

export function listUsers(): Promise<Page<ManagedUser>> {
  return requestPage<ManagedUser>("/users?per_page=200");
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}): Promise<ManagedUser> {
  return request<ManagedUser>("/users", jsonBody(input));
}

export function patchUser(
  id: string,
  input: { name?: string; role?: Role; is_active?: boolean },
): Promise<ManagedUser> {
  return request<ManagedUser>(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function resetUserPassword(
  id: string,
  password: string,
): Promise<{ id: string; password_reset: boolean; sessions_revoked: boolean }> {
  return request(`/users/${encodeURIComponent(id)}/reset-password`, jsonBody({ password }));
}

// -------------------------------------------------------------- G4: outlet

export interface Outlet {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  /** Tarif pajak dalam basis point (100 = 1%). */
  tax_rate_bp: number;
  currency: string;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  version: number;
}

export function getOutlet(): Promise<Outlet> {
  return request<Outlet>("/outlets/me");
}

export function patchOutlet(input: {
  name?: string;
  address?: string | null;
  phone?: string | null;
  tax_rate_bp?: number;
  currency?: string;
}): Promise<Outlet> {
  return request<Outlet>("/outlets/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// --------------------------------------------------------------- G4: promo

export type PromotionType = "percent" | "nominal" | "bogo" | "bundle" | "free_item";

export interface Promotion {
  id: string;
  outlet_id: string;
  name: string;
  code: string | null;
  type: PromotionType;
  config: Record<string, unknown>;
  starts_at: number | null;
  ends_at: number | null;
  is_stackable: boolean;
  max_discount: number | null;
  is_active: boolean;
  created_at: number;
  updated_at: number;
  version: number;
}

export interface PromotionInput {
  name: string;
  code?: string | null;
  type: PromotionType;
  config: Record<string, unknown>;
  starts_at?: number | null;
  ends_at?: number | null;
  is_stackable?: boolean;
  max_discount?: number | null;
  is_active?: boolean;
}

export function listPromotions(): Promise<Page<Promotion>> {
  return requestPage<Promotion>("/promotions?per_page=200");
}

export function createPromotion(input: PromotionInput): Promise<Promotion> {
  return request<Promotion>("/promotions", jsonBody(input));
}

export function patchPromotion(
  id: string,
  input: Partial<PromotionInput>,
): Promise<Promotion> {
  return request<Promotion>(`/promotions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePromotion(id: string): Promise<{ id: string; deleted: boolean }> {
  return request(`/promotions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------------------------------------------------------- G4: sinkronisasi

export interface SyncEventInput {
  client_tx_id: string;
  entity: "order" | "payment";
  payload: Record<string, unknown>;
}

export interface SyncEventResult {
  client_tx_id: string;
  entity: string;
  status: "accepted" | "duplicate" | "rejected";
  entity_id?: string | null;
  error?: { code: string; message: string };
}

export interface SyncPushResult {
  results: SyncEventResult[];
  accepted: number;
  duplicates: number;
  rejected: number;
}

export function syncPush(events: SyncEventInput[]): Promise<SyncPushResult> {
  return request<SyncPushResult>("/sync/push", jsonBody({ events }));
}

export interface SyncPulledOrder {
  id: string;
  order_no: string;
  status: string;
  payment_status: string;
  kitchen_status: string;
  client_tx_id: string | null;
  updated_at: number;
  [key: string]: unknown;
}

export interface SyncPullResult {
  since: number;
  server_time: number;
  categories: unknown[];
  products: unknown[];
  modifiers: unknown[];
  modifier_options: unknown[];
  orders: SyncPulledOrder[];
}

export function syncPull(since: number): Promise<SyncPullResult> {
  return request<SyncPullResult>(`/sync/pull?since=${encodeURIComponent(String(since))}`);
}
