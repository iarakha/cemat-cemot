// Inti alur order: transisi status (RND 7.1), checkout, tracking, bukti bayar, refund, kedaluwarsa.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, menuItems, orderCodeCounters, orderEvents, orderItems, orders, outlets, payments, paymentAccounts, promoPrices } from "@/db/schema";
import { getActivePaymentAccount } from "@/lib/config";
import { getMenuOptions } from "@/lib/menu-options";
import { bookingCode, normalizePhone } from "@/lib/order-rules";
import { orderTotal, resolveOptions, unitPrice } from "@/lib/pricing";
import { ApiError, appUrl, asInput, bad, type Input, pgErr } from "./http";
import { removeStored, saveImage } from "./files";
import { assertCheckoutOpen, getSettings, jakartaNow } from "./store";
import { itemSummary, waHelpAdmin, waNotifyAdmin, type WaOrder } from "./wa";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type OrderStatus = (typeof orders.$inferSelect)["status"];
export type OrderRow = typeof orders.$inferSelect;
export type Actor = "buyer" | "admin" | "system";

// Tabel transisi RND 7.1. Selain ini ditolak.
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["PROOF_SENT", "CANCELLED"],
  PROOF_SENT: ["VERIFYING", "PENDING_PAYMENT", "CANCELLED"],
  VERIFYING: ["PAID", "PENDING_PAYMENT", "CANCELLED"],
  PAID: ["PROCESSING", "REFUND_REQUESTED", "PENDING_PAYMENT"],
  PROCESSING: ["READY", "REFUND_REQUESTED"],
  READY: ["DONE", "REFUND_REQUESTED"],
  DONE: [],
  REFUND_REQUESTED: ["REFUNDED"],
  REFUNDED: [],
  CANCELLED: ["PAID", "REFUND_REQUESTED"],
};
export const ACTIVE_PAYMENT = ["PENDING", "PROOF_SENT", "VERIFYING"] as const;
export const IN_FLIGHT: OrderStatus[] = ["PENDING_PAYMENT", "PROOF_SENT", "VERIFYING"];

export async function lockOrder(tx: Tx, where: { id?: string; token?: string }) {
  const cond = where.id ? eq(orders.id, where.id) : eq(orders.trackingToken, where.token ?? "");
  const [o] = await tx.select().from(orders).where(cond).for("update");
  if (!o) throw new ApiError(404, "NOT_FOUND", "Pesanan tidak ditemukan");
  return o;
}

export class AlreadyProcessed extends Error { constructor(readonly status: OrderStatus) { super("Sudah diproses"); } }

/** Satu pintu ubah status: cek tabel, update order, tulis order_events. Pemanggil sudah mengunci baris (BR-26). */
export async function transition(
  tx: Tx, o: OrderRow, to: OrderStatus, actor: Actor,
  opts: { type?: string; note?: string | null; adminId?: string | null; set?: Partial<typeof orders.$inferInsert> } = {},
) {
  if (o.status === to) throw new AlreadyProcessed(o.status);
  if (!ALLOWED[o.status].includes(to)) {
    throw new ApiError(409, "INVALID_TRANSITION", `Status ${o.status} tidak bisa menjadi ${to}`, { status: o.status });
  }
  await tx.update(orders).set({ status: to, ...opts.set }).where(eq(orders.id, o.id));
  await addEvent(tx, o.id, o.status, to, opts.type ?? "STATUS", actor, opts.adminId, opts.note);
}
export const addEvent = (tx: Tx, orderId: string, from: OrderStatus | null, to: OrderStatus | null, type: string, actor: Actor, adminId?: string | null, note?: string | null) =>
  tx.insert(orderEvents).values({ orderId, fromStatus: from, toStatus: to, type, actor, adminId: adminId ?? null, note: note ?? null });

/** Jalankan aksi terkunci; aksi kedua pada status yang sama -> 200 alreadyProcessed tanpa mengubah apa pun (BR-26). */
export async function locked<T>(where: { id?: string; token?: string }, fn: (tx: Tx, o: OrderRow) => Promise<T>): Promise<T | { alreadyProcessed: true; status: OrderStatus }> {
  try {
    return await db.transaction(async (tx) => fn(tx, await lockOrder(tx, where)));
  } catch (e) {
    if (e instanceof AlreadyProcessed) return { alreadyProcessed: true, status: e.status };
    throw e;
  }
}

export async function activePayment(tx: Tx, orderId: string) {
  const [p] = await tx.select().from(payments).where(and(eq(payments.orderId, orderId), inArray(payments.status, [...ACTIVE_PAYMENT]))).for("update");
  return p ?? null;
}
export async function newPendingPayment(tx: Tx, o: OrderRow) {
  await tx.insert(payments).values({ orderId: o.id, expectedAmount: o.total, status: "PENDING" });
}

// ---------- Checkout (API-02) ----------
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
export const isToken = (t: string) => TOKEN_RE.test(t);

export async function checkout(body: Input) {
  const idem = body.has("idempotencyKey") ? body.uuid("idempotencyKey") : null;
  const brandSlug = body.str("brandSlug", 1, 40);
  const outletId = body.uuid("outletId");
  const cust = asInput(body.o.customer, "customer");
  const name = cust.str("name", 2, 40);
  let phone: string;
  try { phone = normalizePhone(cust.str("phone", 1, 20)); } catch (e) { throw bad("customer.phone", (e as Error).message); }
  const expectedTotal = body.int("expectedTotal", 0, 100_000_000);
  const rawItems = body.arr("items", 20);
  if (rawItems.length === 0) throw bad("items", "keranjang kosong");
  const lines = rawItems.map((r, i) => {
    const it = asInput(r, `items[${i}]`);
    return {
      menuItemId: it.uuid("menuItemId"), qty: it.int("qty", 1, 10), note: it.optStr("note", 100),
      choiceIds: it.has("choiceIds") ? it.arr("choiceIds", 20).map((c) => asInput({ v: c }, "choiceIds").uuid("v")) : [],
    };
  });

  if (idem) {
    const [prev] = await db.select({ token: orders.trackingToken }).from(orders).where(eq(orders.idempotencyKey, idem));
    if (prev) return { token: prev.token, replay: true };
  }

  const settings = await getSettings();
  await assertCheckoutOpen(settings);
  const cups = lines.reduce((a, l) => a + l.qty, 0);
  if (cups > settings.maxCups) throw new ApiError(422, "LIMIT_EXCEEDED", `Maksimal ${settings.maxCups} item per pesanan`);

  const [brand] = await db.select().from(brands).where(and(eq(brands.slug, brandSlug), eq(brands.isActive, true)));
  if (!brand) throw new ApiError(422, "ITEM_UNAVAILABLE", "Brand tidak tersedia");
  const [outlet] = await db.select().from(outlets).where(and(eq(outlets.id, outletId), eq(outlets.brandId, brand.id), eq(outlets.isActive, true)));
  if (!outlet) throw new ApiError(422, "OUTLET_INACTIVE", "Outlet tidak aktif atau bukan milik brand ini");

  const ids = [...new Set(lines.map((l) => l.menuItemId))];
  const menu = await db.select().from(menuItems).where(and(inArray(menuItems.id, ids), eq(menuItems.brandId, brand.id), eq(menuItems.isAvailable, true)));
  if (menu.length !== ids.length) throw new ApiError(422, "ITEM_UNAVAILABLE", "Ada menu yang tidak tersedia");
  const promos = await db.select().from(promoPrices).where(inArray(promoPrices.menuItemId, ids));

  const priced: { m: typeof menuItems.$inferSelect; l: (typeof lines)[number]; price: number; snapshot: { group: string; label: string; priceDelta: number }[] }[] = [];
  for (const l of lines) {
    const m = menu.find((x) => x.id === l.menuItemId)!;
    let r;
    try { r = resolveOptions(await getMenuOptions(m.id), l.choiceIds); } catch (e) { throw new ApiError(422, "INVALID_OPTION", (e as Error).message); }
    const price = unitPrice(m.normalPrice, promos.find((p) => p.menuItemId === m.id)?.promoPrice ?? null, r.deltas);
    priced.push({ m, l, price, snapshot: r.snapshot });
  }
  const subtotal = priced.reduce((a, p) => a + p.price * p.l.qty, 0);
  const total = orderTotal(priced.map((p) => ({ unitPrice: p.price, qty: p.l.qty })), settings.serviceFee, 0); // BR-06: tanpa kode unik
  if (total !== expectedTotal) throw new ApiError(409, "PRICE_CHANGED", "Harga berubah", { expectedTotal: total });
  if (total <= 0) throw new ApiError(422, "ITEM_UNAVAILABLE", "Total pesanan tidak valid");

  const token = randomBytes(16).toString("base64url"); // BR-18
  const expiresAt = new Date(Date.now() + settings.paymentWindowMin * 60_000);
  try {
    await db.transaction(async (tx) => {
      const { day } = jakartaNow();
      const [c] = await tx.insert(orderCodeCounters).values({ day, lastValue: 1 })
        .onConflictDoUpdate({ target: orderCodeCounters.day, set: { lastValue: sql`${orderCodeCounters.lastValue} + 1` } }).returning();
      const [o] = await tx.insert(orders).values({
        trackingToken: token, orderCode: bookingCode(day, c.lastValue, brand.slug), idempotencyKey: idem,
        customerName: name, customerPhone: phone, outletId: outlet.id, subtotal, serviceFee: settings.serviceFee, uniqueCode: 0, total, expiresAt,
      }).returning();
      await tx.insert(orderItems).values(priced.map((p) => ({
        orderId: o.id, menuItemId: p.m.id, nameSnapshot: p.m.name, unitPrice: p.price, qty: p.l.qty, optionsSnapshot: p.snapshot, note: p.l.note,
      })));
      await newPendingPayment(tx, o);
      await addEvent(tx, o.id, null, "PENDING_PAYMENT", "ORDER_CREATED", "buyer");
    });
  } catch (e) {
    if (idem && pgErr(e).code === "23505") { // dua permintaan paralel dengan kunci sama
      const [prev] = await db.select({ token: orders.trackingToken }).from(orders).where(eq(orders.idempotencyKey, idem));
      if (prev) return { token: prev.token, replay: true };
    }
    throw e;
  }
  console.log(JSON.stringify({ level: "info", event: "checkout_created", brand: brand.slug }));
  return { token, replay: false };
}

// ---------- Tracking (API-03) ----------
export async function orderBundle(where: { token?: string; id?: string }) {
  const cond = where.id ? eq(orders.id, where.id) : eq(orders.trackingToken, where.token ?? "");
  const [row] = await db.select({ o: orders, outletName: outlets.name, outletAddress: outlets.address, brandSlug: brands.slug, brandName: brands.name })
    .from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).innerJoin(brands, eq(brands.id, outlets.brandId)).where(cond);
  if (!row) return null;
  const [items, pays, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, row.o.id)),
    db.select().from(payments).where(eq(payments.orderId, row.o.id)).orderBy(desc(payments.createdAt)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, row.o.id)).orderBy(asc(orderEvents.createdAt)),
  ]);
  return { ...row, items, pays, events };
}
type Bundle = NonNullable<Awaited<ReturnType<typeof orderBundle>>>;

export const waOrderOf = (b: Bundle): WaOrder => ({
  orderCode: b.o.orderCode, customerName: b.o.customerName, customerPhone: b.o.customerPhone, total: b.o.total, trackingToken: b.o.trackingToken,
  brand: b.brandName, outlet: b.outletName, items: b.items.map((i) => ({ name: i.nameSnapshot, qty: i.qty })),
});

/** BR-43: jam fase dari order_events; setelah reset (kembali ke PENDING_PAYMENT) hanya rangkaian terbaru yang dipakai. */
export function phaseTimes(events: Bundle["events"]) {
  let start = 0;
  events.forEach((e, i) => { if (e.toStatus === "PENDING_PAYMENT" && e.fromStatus) start = i; });
  const out: Record<string, string> = {};
  for (const e of events.slice(start)) if (e.toStatus && e.fromStatus !== e.toStatus) out[e.toStatus] = e.createdAt.toISOString();
  return out;
}

export async function trackingView(token: string) {
  if (!isToken(token)) return null;
  const b = await orderBundle({ token });
  if (!b) return null;
  const settings = await getSettings();
  const pay = b.pays[0] ?? null;
  const accounts = b.o.status === "PENDING_PAYMENT" || b.o.status === "PROOF_SENT"
    ? await db.select().from(paymentAccounts).where(and(eq(paymentAccounts.isActive, true), eq(paymentAccounts.type, "QRIS_STATIC"))).orderBy(asc(paymentAccounts.sortOrder), asc(paymentAccounts.id))
    : [];
  const wa = waOrderOf(b);
  const refundState = b.o.status === "REFUND_REQUESTED" ? (b.o.refundAccountNo ? "SUBMITTED" : "NEEDED") : b.o.status === "REFUNDED" ? "DONE" : null;
  return {
    orderCode: b.o.orderCode, status: b.o.status, customerName: b.o.customerName, createdAt: b.o.createdAt, expiresAt: b.o.expiresAt, cancelReason: b.o.cancelReason,
    items: b.items.map((i) => ({ name: i.nameSnapshot, qty: i.qty, unitPrice: i.unitPrice, options: i.optionsSnapshot, note: i.note })),
    totals: { subtotal: b.o.subtotal, fee: b.o.serviceFee, uniqueCode: b.o.uniqueCode, total: b.o.total },
    queueNumber: b.o.queueNumber, hasOrderProof: !!b.o.proofImagePath,
    outlet: { name: b.outletName, address: b.outletAddress, brand: b.brandName },
    paymentAccounts: accounts.map((a) => ({ id: a.id, type: a.type, provider: a.provider, accountName: a.accountName, qrisUrl: a.type === "QRIS_STATIC" ? `/api/qris/${a.id}` : null })),
    payment: pay ? { status: pay.status, hasProof: !!pay.proofImagePath, claimedAt: pay.proofClaimedAt } : null,
    phases: phaseTimes(b.events), refundState, verifyEtaMin: settings.verifyEtaMin,
    adminWa: settings.adminWa,
    waUrls: settings.adminWa ? { notifyAdmin: waNotifyAdmin(settings.adminWa, wa), help: waHelpAdmin(settings.adminWa, wa) } : null,
    trackingUrl: `${appUrl()}/pesanan/${token}`, itemSummary: itemSummary(wa.items),
  };
}

// ---------- Bukti bayar (API-05; juga dipakai admin, BR-38) ----------
export async function submitPaymentProof(where: { token?: string; id?: string }, file: File, actor: Actor, adminId?: string | null) {
  const pre = await db.select({ status: orders.status, expiresAt: orders.expiresAt, cancelReason: orders.cancelReason })
    .from(orders).where(where.id ? eq(orders.id, where.id) : eq(orders.trackingToken, where.token ?? "")).then((r) => r[0]);
  if (!pre) throw new ApiError(404, "NOT_FOUND", "Pesanan tidak ditemukan");
  gate(pre, actor);
  const rel = await saveImage(file, "payment-proofs");
  let oldPath: string | null = null;
  try {
    const res = await locked(where, async (tx, o) => {
      gate(o, actor);
      const p = await activePayment(tx, o.id);
      if (!p) throw new ApiError(409, "INVALID_TRANSITION", "Tidak ada pembayaran aktif");
      const acc = await getActivePaymentAccount();
      if (!acc) throw new ApiError(422, "PAYMENT_NOT_READY", "Belum ada tujuan pembayaran aktif");
      const now = new Date();
      oldPath = p.proofImagePath;
      const snapshot = { provider: acc.provider, accountName: acc.accountName, ...(acc.accountNo ? { accountNo: acc.accountNo } : {}) };
      if (o.status === "PENDING_PAYMENT") {
        await tx.update(payments).set({ status: "PROOF_SENT", method: acc.type, paymentAccountId: acc.id, destinationSnapshot: snapshot, proofImagePath: rel, proofClaimedAt: now }).where(eq(payments.id, p.id));
        await transition(tx, o, "PROOF_SENT", actor, { type: "PROOF_CLAIMED", adminId });
      } else { // PROOF_SENT: ganti foto, status tetap (6.5 step 7 & 10)
        await tx.update(payments).set({ proofImagePath: rel, proofClaimedAt: now }).where(eq(payments.id, p.id));
        await addEvent(tx, o.id, o.status, o.status, "PROOF_REPLACED", actor, adminId);
      }
      return { ok: true as const };
    });
    if ("alreadyProcessed" in res) throw new ApiError(409, "INVALID_TRANSITION", "Status tidak bisa menerima bukti");
  } catch (e) {
    await removeStored(rel);
    throw e;
  }
  if (oldPath) await removeStored(oldPath);
  console.log(JSON.stringify({ level: "info", event: "proof_uploaded", actor }));
}
function gate(o: { status: OrderStatus; expiresAt: Date; cancelReason: string | null }, actor: Actor) {
  if (o.status === "CANCELLED" && o.cancelReason === "EXPIRED") throw new ApiError(410, "EXPIRED", "Waktu bayar habis. Jika sudah bayar, hubungi admin dan sebutkan kode pesanan");
  if (o.status === "VERIFYING") throw new ApiError(409, "LOCKED", "Pembayaran sedang diverifikasi, bukti tidak bisa diganti");
  if (o.status !== "PENDING_PAYMENT" && o.status !== "PROOF_SENT") throw new ApiError(409, "INVALID_TRANSITION", "Pesanan tidak menerima bukti pembayaran");
  if (actor === "buyer" && o.status === "PENDING_PAYMENT" && o.expiresAt.getTime() < Date.now()) {
    throw new ApiError(410, "EXPIRED", "Waktu bayar habis. Jika sudah bayar, hubungi admin dan sebutkan kode pesanan");
  }
}

// ---------- Rekening refund (API-04) ----------
export async function setRefundAccount(token: string, body: Input) {
  const method = body.oneOf("method", ["BANK", "EWALLET"] as const);
  const provider = body.str("provider", 2, 40);
  const accountNo = body.str("accountNo", 5, 30);
  if (!/^[0-9]+$/.test(accountNo)) throw bad("accountNo", "hanya digit");
  const accountName = body.str("accountName", 2, 60);
  if (!isToken(token)) throw new ApiError(404, "NOT_FOUND", "Pesanan tidak ditemukan");
  await db.transaction(async (tx) => {
    const o = await lockOrder(tx, { token });
    if (o.status !== "REFUND_REQUESTED") throw new ApiError(409, "INVALID_TRANSITION", "Pesanan tidak sedang menunggu refund");
    await tx.update(orders).set({ refundMethod: method, refundProvider: provider, refundAccountNo: accountNo, refundAccountName: accountName }).where(eq(orders.id, o.id));
    await addEvent(tx, o.id, o.status, o.status, "REFUND_ACCOUNT_SET", "buyer"); // BR-23: data rekening tidak masuk event/log
  });
}

// ---------- Kedaluwarsa (API-07) ----------
export async function expireOrders() {
  return db.transaction(async (tx) => {
    const due = await tx.select().from(orders).where(and(eq(orders.status, "PENDING_PAYMENT"), lt(orders.expiresAt, new Date()))).for("update", { skipLocked: true });
    for (const o of due) {
      await tx.update(payments).set({ status: "EXPIRED" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "PENDING")));
      await transition(tx, o, "CANCELLED", "system", { type: "ORDER_EXPIRED", set: { cancelReason: "EXPIRED" } });
    }
    return due.length;
  });
}
