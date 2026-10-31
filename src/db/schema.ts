import { sql } from "drizzle-orm";
import {
  boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgEnum, pgTable,
  primaryKey, text, time, timestamp, unique, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// Semua harga = integer rupiah.
export const outletSource = pgEnum("outlet_source", ["OSM", "MANUAL"]);
export const orderStatus = pgEnum("order_status", [
  "PENDING_PAYMENT", "PROOF_SENT", "VERIFYING", "PAID", "PROCESSING", "READY", "DONE",
  "REFUND_REQUESTED", "REFUNDED", "CANCELLED",
]);
export const paymentStatus = pgEnum("payment_status", ["PENDING", "PROOF_SENT", "VERIFYING", "VERIFIED", "REJECTED", "EXPIRED"]);
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

// Harga promo per menu (maks satu). Persen hemat dihitung saat dibaca: savingPercent() di lib/pricing.ts.
// ponytail: tanpa periode; tambahkan starts_at/ends_at jika promo perlu kedaluwarsa otomatis.
export const promoPrices = pgTable("promo_prices", {
  menuItemId: uuid("menu_item_id").primaryKey().references(() => menuItems.id, { onDelete: "cascade" }),
  promoPrice: integer("promo_price").notNull(),
}, (t) => [check("promo_prices_price_chk", sql`${t.promoPrice} > 0`)]);

// Master pilihan: didefinisikan sekali (Suhu, Ukuran, Gula, ...), ditautkan ke menu lewat menu_item_choices.
export const optionGroups = pgTable("option_groups", {
  id: id(),
  name: text("name").notNull().unique(),
  required: boolean("required").notNull().default(false),
  maxSelect: integer("max_select").notNull().default(1), // 1 = pilih satu (radio); >1 = add-on
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [check("option_groups_max_select_chk", sql`${t.maxSelect} >= 1`)]);

export const optionChoices = pgTable("option_choices", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => optionGroups.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  unique("option_choices_group_label_uq").on(t.groupId, t.label),
  unique("option_choices_id_group_uq").on(t.id, t.groupId), // target FK komposit di menu_item_choices
]);

// Pilihan yang berlaku untuk satu menu + selisih harga khusus menu itu (boleh negatif).
// group_id disalin dari pilihan (dijaga FK komposit) agar "satu default per grup per menu" bisa dipaksa DB.
export const menuItemChoices = pgTable("menu_item_choices", {
  menuItemId: uuid("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "cascade" }),
  choiceId: uuid("choice_id").notNull(),
  groupId: uuid("group_id").notNull(),
  priceDelta: integer("price_delta").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.menuItemId, t.choiceId] }),
  foreignKey({ columns: [t.choiceId, t.groupId], foreignColumns: [optionChoices.id, optionChoices.groupId], name: "menu_item_choices_choice_group_fk" }).onDelete("cascade"),
  uniqueIndex("menu_item_choices_one_default_uq").on(t.menuItemId, t.groupId).where(sql`${t.isDefault}`),
  index("menu_item_choices_choice_idx").on(t.choiceId),
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
  uniqueCode: integer("unique_code").notNull().default(0), // legacy; order QRIS baru selalu 0
  total: integer("total").notNull(), // subtotal + service_fee + unique_code
  expiresAt: ts("expires_at").notNull(),
  queueNumber: text("queue_number"), // kode pickup string dari admin; dash opsional, tidak unik
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
  index("orders_history_idx").on(t.customerPhone, t.createdAt, t.id),
  index("orders_queue_idx").on(t.queueNumber),
  index("orders_created_idx").on(t.createdAt),
  index("orders_total_idx").on(t.total),
  uniqueIndex("orders_active_unique_code_uq").on(t.uniqueCode)
    // Aktif = PENDING_PAYMENT/PROOF_SENT. Ditulis sebagai NOT IN status lain karena nilai enum baru
    // (PROOF_SENT) tidak boleh dipakai di transaksi migrasi yang sama. Perbarui jika status ditambah.
    .where(sql`${t.uniqueCode} > 0 AND ${t.status} NOT IN ('PAID', 'PROCESSING', 'READY', 'DONE', 'REFUND_REQUESTED', 'REFUNDED', 'CANCELLED')`),
  check("orders_total_chk", sql`${t.total} = ${t.subtotal} + ${t.serviceFee} + ${t.uniqueCode}`),
  check("orders_money_chk", sql`${t.subtotal} >= 0 AND ${t.serviceFee} >= 0`),
  check("orders_unique_code_chk", sql`${t.uniqueCode} BETWEEN 0 AND 99`),
  check("orders_queue_format_chk", sql`${t.queueNumber} IS NULL OR (char_length(btrim(${t.queueNumber})) BETWEEN 1 AND 64 AND ${t.queueNumber} !~ '[[:cntrl:]]')`),
  check("orders_phone_chk", sql`${t.customerPhone} ~ '^628[0-9]{8,11}$'`),
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
  phone: text("phone"), // opsional; jika diisi format 62...
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
  uniqueIndex("payments_active_order_uq").on(t.orderId).where(sql`${t.status} NOT IN ('VERIFIED', 'REJECTED', 'EXPIRED')`),
  check("payments_proof_chk", sql`${t.status}::text NOT IN ('PROOF_SENT', 'VERIFYING') OR (${t.proofImagePath} IS NOT NULL AND ${t.proofClaimedAt} IS NOT NULL)`),
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
  paymentWindowMin: integer("payment_window_min").notNull().default(15),
  checkoutCutoffMin: integer("checkout_cutoff_min").notNull().default(30),
  verifyEtaMin: integer("verify_eta_min").notNull().default(10),
  useUniqueCode: boolean("use_unique_code").notNull().default(false),
  maxCups: integer("max_cups").notNull().default(10),
  closedMessage: text("closed_message"),
}, (t) => [
  check("store_settings_singleton_chk", sql`${t.id} = 1`),
  check("store_settings_wa_chk", sql`${t.adminWa} IS NULL OR ${t.adminWa} ~ '^62[0-9]{8,13}$'`),
  check("store_settings_limits_chk", sql`${t.paymentWindowMin} > 0 AND ${t.checkoutCutoffMin} >= 0 AND ${t.verifyEtaMin} > 0 AND ${t.maxCups} > 0 AND ${t.serviceFee} >= 0`),
]);

export const adminUsers = pgTable("admin_users", {
  id: id(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
}, (t) => [
  check("admin_users_username_chk", sql`${t.username} ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'`),
]);

// Cookie menyimpan token acak; DB hanya hash. Akses dibatasi nomor yang terverifikasi.
export const customerSessions = pgTable("customer_sessions", {
  id: id(),
  customerPhone: text("customer_phone").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("customer_sessions_expires_idx").on(t.expiresAt),
  check("customer_sessions_phone_chk", sql`${t.customerPhone} ~ '^628[0-9]{8,11}$'`),
  check("customer_sessions_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
]);

// OTP HMAC memakai secret server, tidak pernah plaintext/hash OTP tanpa secret.
export const customerOtpChallenges = pgTable("customer_otp_challenges", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  sentAt: ts("sent_at"), // null sampai provider mengonfirmasi penerimaan pengiriman
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  index("customer_otp_order_idx").on(t.orderId, t.createdAt),
  check("customer_otp_attempts_chk", sql`${t.attempts} BETWEEN 0 AND 5`),
  check("customer_otp_expiry_chk", sql`${t.expiresAt} > ${t.createdAt}`),
]);

// Kunci = HMAC(scope + IP / nomor HP); tidak menyimpan input pribadi di log.
export const requestLimits = pgTable("request_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: ts("reset_at").notNull(),
}, (t) => [
  index("request_limits_reset_idx").on(t.resetAt),
  check("request_limits_count_chk", sql`${t.count} > 0`),
]);

// Satu counter global per tanggal WIB; alokasi atomik di transaksi checkout.
export const orderCodeCounters = pgTable("order_code_counters", {
  day: date("day").primaryKey(),
  lastValue: integer("last_value").notNull(),
}, (t) => [check("order_code_counters_value_chk", sql`${t.lastValue} > 0`)]);

export const adminSessions = pgTable("admin_sessions", {
  id: id(),
  adminId: uuid("admin_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 dari cookie
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
