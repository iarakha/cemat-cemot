import { sql } from "drizzle-orm";
import {
  boolean, check, doublePrecision, index, integer, jsonb, pgEnum, pgTable,
  text, time, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// Semua harga = integer rupiah.
export const promoType = pgEnum("promo_type", ["PERCENT", "AMOUNT_OFF", "FIXED_PRICE"]);
export const outletSource = pgEnum("outlet_source", ["OSM", "MANUAL"]);
export const orderStatus = pgEnum("order_status", [
  "PENDING_PAYMENT", "PROOF_SENT", "PAID", "PROCESSING", "READY", "DONE",
  "REFUND_REQUESTED", "REFUNDED", "CANCELLED",
]);
export const paymentStatus = pgEnum("payment_status", ["PENDING", "PROOF_SENT", "VERIFIED", "REJECTED", "EXPIRED"]);
// Tipe tujuan bayar. v1 hanya QRIS_STATIC; BANK/EWALLET disiapkan untuk penambahan akun nanti.
// Status toko jasdor. Hanya OPEN yang menerima checkout.
// OPEN = buka, CLOSED = tutup, BREAK = istirahat, PRAYER = solat, LEAVE = cuti.
export const storeStatus = pgEnum("store_status", ["OPEN", "CLOSED", "BREAK", "PRAYER", "LEAVE"]);
export const paymentMethod = pgEnum("payment_method", ["BANK", "EWALLET", "QRIS_STATIC"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const brands = pgTable("brands", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  accentColor: text("accent_color").notNull(),
  logoUrl: text("logo_url"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  osmQuery: text("osm_query"), // pola nama untuk Overpass
});

export const menuItems = pgTable("menu_items", {
  id: id(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  normalPrice: integer("normal_price").notNull(),
  imageUrl: text("image_url"),
  isAvailable: boolean("is_available").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  index("menu_items_brand_idx").on(t.brandId),
  check("menu_items_price_chk", sql`${t.normalPrice} >= 0`),
]);

export const optionGroups = pgTable("option_groups", {
  id: id(),
  menuItemId: uuid("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  required: boolean("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const optionChoices = pgTable("option_choices", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => optionGroups.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  priceDelta: integer("price_delta").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
}, (t) => [uniqueIndex("option_choices_one_default_uq").on(t.groupId).where(sql`${t.isDefault}`)]);

export const promos = pgTable("promos", {
  id: id(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "cascade" }), // null = satu brand
  title: text("title").notNull(),
  type: promoType("type").notNull(),
  value: integer("value").notNull(),
  terms: text("terms"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [
  index("promos_brand_idx").on(t.brandId),
  check("promos_period_chk", sql`${t.endsAt} > ${t.startsAt}`),
  check("promos_value_chk", sql`${t.value} > 0 AND (${t.type} <> 'PERCENT' OR ${t.value} <= 100)`),
]);

export const outlets = pgTable("outlets", {
  id: id(),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  osmId: text("osm_id").unique(), // null jika MANUAL
  source: outletSource("source").notNull().default("MANUAL"),
  isActive: boolean("is_active").notNull().default(true),
  syncedAt: ts("synced_at"),
}, (t) => [
  index("outlets_brand_idx").on(t.brandId),
  check("outlets_coord_chk", sql`${t.lat} BETWEEN -90 AND 90 AND ${t.lng} BETWEEN -180 AND 180`),
]);

export const orders = pgTable("orders", {
  id: id(),
  trackingToken: text("tracking_token").notNull().unique(),
  orderCode: text("order_code").notNull().unique(),
  idempotencyKey: text("idempotency_key").unique(),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  outletId: uuid("outlet_id").notNull().references(() => outlets.id),
  status: orderStatus("status").notNull().default("PENDING_PAYMENT"),
  subtotal: integer("subtotal").notNull(),
  serviceFee: integer("service_fee").notNull(),
  uniqueCode: integer("unique_code").notNull().default(0), // 0-99, 0 jika fitur mati
  total: integer("total").notNull(), // subtotal + service_fee + unique_code
  expiresAt: ts("expires_at").notNull(),
  queueNumber: text("queue_number"), // teks dari outlet, mis. A047. Diisi admin saat READY
  proofImagePath: text("proof_image_path"), // foto bukti pesanan dari admin, relatif ke UPLOAD_DIR
  cancelReason: text("cancel_reason"),
  refundMethod: text("refund_method"), // BANK | EWALLET
  refundProvider: text("refund_provider"),
  refundAccountNo: text("refund_account_no"),
  refundAccountName: text("refund_account_name"),
  createdAt: ts("created_at").notNull().defaultNow(),
  paidAt: ts("paid_at"),
  refundedAt: ts("refunded_at"),
}, (t) => [
  index("orders_status_idx").on(t.status),
  index("orders_phone_idx").on(t.customerPhone),
  index("orders_created_idx").on(t.createdAt),
  index("orders_total_idx").on(t.total),
  uniqueIndex("orders_active_unique_code_uq").on(t.uniqueCode)
    // Aktif = PENDING_PAYMENT/PROOF_SENT. Ditulis sebagai NOT IN status lain karena nilai enum baru
    // (PROOF_SENT) tidak boleh dipakai di transaksi migrasi yang sama. Perbarui jika status ditambah.
    .where(sql`${t.uniqueCode} > 0 AND ${t.status} NOT IN ('PAID', 'PROCESSING', 'READY', 'DONE', 'REFUND_REQUESTED', 'REFUNDED', 'CANCELLED')`),
  check("orders_total_chk", sql`${t.total} = ${t.subtotal} + ${t.serviceFee} + ${t.uniqueCode}`),
  check("orders_money_chk", sql`${t.subtotal} >= 0 AND ${t.serviceFee} >= 0`),
  check("orders_unique_code_chk", sql`${t.uniqueCode} BETWEEN 0 AND 99`),
  check("orders_queue_format_chk", sql`${t.queueNumber} IS NULL OR ${t.queueNumber} ~ '^[A-Z0-9-]{1,12}$'`),
  check("orders_ready_chk", sql`${t.status} NOT IN ('READY', 'DONE') OR (${t.queueNumber} IS NOT NULL AND ${t.proofImagePath} IS NOT NULL)`),
]);

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  menuItemId: uuid("menu_item_id").notNull().references(() => menuItems.id),
  nameSnapshot: text("name_snapshot").notNull(),
  unitPrice: integer("unit_price").notNull(), // snapshot, setelah promo + opsi
  qty: integer("qty").notNull(),
  optionsSnapshot: jsonb("options_snapshot").$type<{ group: string; label: string; priceDelta: number }[]>().notNull().default([]),
  note: text("note"),
}, (t) => [
  check("order_items_qty_chk", sql`${t.qty} BETWEEN 1 AND 10`),
  check("order_items_price_chk", sql`${t.unitPrice} >= 0`),
  check("order_items_note_chk", sql`${t.note} IS NULL OR char_length(${t.note}) <= 100`),
]);

// Tujuan bayar. Jangan dihapus: dipakai untuk menambah rekening/e-wallet nanti.
export const paymentAccounts = pgTable("payment_accounts", {
  id: id(),
  type: paymentMethod("type").notNull(),
  provider: text("provider").notNull(), // BCA, DANA, ... atau nama merchant untuk QRIS
  accountNo: text("account_no"),
  accountName: text("account_name").notNull(),
  qrisImagePath: text("qris_image_path"), // relatif ke UPLOAD_DIR
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  check("payment_accounts_dest_chk", sql`(${t.type} = 'QRIS_STATIC' AND ${t.qrisImagePath} IS NOT NULL) OR (${t.type} <> 'QRIS_STATIC' AND ${t.accountNo} IS NOT NULL)`),
]);

// Partner pelaksana (berbeda dari brand). Ditautkan ke payment saat admin memverifikasi.
export const partnerCompanies = pgTable("partner_companies", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone").notNull(), // format 62...
  website: text("website"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  check("partner_companies_phone_chk", sql`${t.phone} ~ '^62[0-9]{8,13}$'`),
  check("partner_companies_website_chk", sql`${t.website} IS NULL OR ${t.website} ~* '^https?://'`),
]);

export const payments = pgTable("payments", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  method: paymentMethod("method"), // terisi saat bukti diunggah
  paymentAccountId: uuid("payment_account_id").references(() => paymentAccounts.id),
  destinationSnapshot: jsonb("destination_snapshot").$type<{ provider: string; accountNo?: string; accountName: string }>(),
  expectedAmount: integer("expected_amount").notNull(),
  paidAmount: integer("paid_amount"), // nominal yang dikonfirmasi admin
  status: paymentStatus("status").notNull().default("PENDING"),
  note: text("note"),
  proofImagePath: text("proof_image_path"), // foto bukti bayar dari pembeli
  proofClaimedAt: ts("proof_claimed_at"),
  verifiedAt: ts("verified_at"),
  verifiedBy: uuid("verified_by").references(() => adminUsers.id),
  partnerCompanyId: uuid("partner_company_id").references(() => partnerCompanies.id), // wajib saat VERIFIED
  partnerAmount: integer("partner_amount"), // nominal yang dibayarkan ke partner, wajib saat VERIFIED
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("payments_order_idx").on(t.orderId),
  uniqueIndex("payments_active_order_uq").on(t.orderId).where(sql`${t.status} IN ('PENDING', 'PROOF_SENT')`),
  check("payments_expected_chk", sql`${t.expectedAmount} > 0`),
  check("payments_paid_chk", sql`${t.paidAmount} IS NULL OR ${t.paidAmount} >= 0`),
  check("payments_verified_partner_chk", sql`${t.status} <> 'VERIFIED' OR (${t.partnerCompanyId} IS NOT NULL AND ${t.partnerAmount} IS NOT NULL)`),
  check("payments_partner_amount_chk", sql`${t.partnerAmount} IS NULL OR ${t.partnerAmount} >= 0`),
  index("payments_partner_idx").on(t.partnerCompanyId),
]);

// Jejak audit, hanya ditambah.
export const orderEvents = pgTable("order_events", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  fromStatus: orderStatus("from_status"),
  toStatus: orderStatus("to_status"),
  type: text("type").notNull(), // STATUS, PROOF_CLAIMED, PAYMENT_VERIFIED, ...
  actor: text("actor").notNull(), // buyer | admin | system
  adminId: uuid("admin_id").references(() => adminUsers.id),
  note: text("note"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("order_events_order_idx").on(t.orderId, t.createdAt),
  check("order_events_actor_chk", sql`${t.actor} IN ('buyer', 'admin', 'system')`),
]);

export const storeSettings = pgTable("store_settings", {
  id: integer("id").primaryKey().default(1), // selalu 1
  status: storeStatus("status").notNull().default("OPEN"),
  openAt: time("open_at").notNull().default("08:00"),
  closeAt: time("close_at").notNull().default("21:00"),
  serviceFee: integer("service_fee").notNull().default(5000),
  adminWa: text("admin_wa"), // format 62..., wajib sebelum toko dibuka
  paymentWindowMin: integer("payment_window_min").notNull().default(30),
  checkoutCutoffMin: integer("checkout_cutoff_min").notNull().default(30),
  verifyEtaMin: integer("verify_eta_min").notNull().default(10),
  useUniqueCode: boolean("use_unique_code").notNull().default(true),
  maxCups: integer("max_cups").notNull().default(10),
  closedMessage: text("closed_message"),
}, (t) => [
  check("store_settings_singleton_chk", sql`${t.id} = 1`),
  check("store_settings_wa_chk", sql`${t.adminWa} IS NULL OR ${t.adminWa} ~ '^62[0-9]{8,13}$'`),
  check("store_settings_limits_chk", sql`${t.paymentWindowMin} > 0 AND ${t.checkoutCutoffMin} >= 0 AND ${t.verifyEtaMin} > 0 AND ${t.maxCups} > 0 AND ${t.serviceFee} >= 0`),
]);

export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: id(),
  adminId: uuid("admin_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 dari cookie
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
