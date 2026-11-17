import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, fulfillmentAttempts, orders, outlets, payments, partnerCompanies } from "@/db/schema";
import { ApiError, Input, NOT_FOUND } from "./http";
import { removeStored, saveImage } from "./files";
import { getSettings } from "./store";
import { ACTIVE_PAYMENT, AlreadyProcessed, activePayment, addEvent, locked, newPendingPayment, orderBundle, transition, waOrderOf, type OrderStatus } from "./order-flow";
import { waConfirmed, waProcessing, waRejected } from "./wa";

export async function listOrders(sp: URLSearchParams) {
  const b = new Input(Object.fromEntries(sp));
  const limit = b.has("limit") ? b.int("limit", 1, 50) : 20;
  const offset = b.has("offset") ? b.int("offset", 0, 1_000_000) : 0;
  const status = b.has("status") ? b.oneOf("status", ["PENDING_PAYMENT", "PROOF_SENT", "VERIFYING", "PAID", "PROCESSING", "DONE", "REFUND_REQUESTED", "REFUNDED", "CANCELLED"] as const) : null;
  // q: cari kode booking, nomor antrean, nama, atau nomor HP (HP dinormalkan; ILIKE dengan wildcard di-escape).
  const q = b.optStr("q", 64);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  // Angka saja = potongan nomor HP: 08xx -> 628xx, cocok sebagian (admin sering ketik sebagian nomor).
  const digits = q && /^\d+$/.test(q) ? q.replace(/^0/, "62") : null;
  const search = q ? or(ilike(orders.orderCode, like!), ilike(orders.queueNumber, like!), ilike(orders.customerName, like!), digits ? ilike(orders.customerPhone, `%${digits}%`) : undefined) : undefined;
  // counts: per status, mengikuti pencarian q tetapi bukan filter status (untuk chip filter); total mengikuti keduanya.
  const countRows = await db.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders).where(search).groupBy(orders.status);
  const counts: Record<string, number> = { ALL: 0 };
  for (const r of countRows) { counts[r.status] = r.n; counts.ALL += r.n; }
  const total = status ? counts[status] ?? 0 : counts.ALL;
  const rows = await db.select({
    id: orders.id, orderCode: orders.orderCode, status: orders.status, customerName: orders.customerName, customerPhone: orders.customerPhone,
    queueNumber: orders.queueNumber, brand: brands.name, outlet: outlets.name, total: orders.total,
    hasOrderProof: sql<boolean>`${orders.orderProofPath} IS NOT NULL`, orderProofAt: orders.orderProofAt, createdAt: orders.createdAt, paidAt: orders.paidAt,
  }).from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).innerJoin(brands, eq(brands.id, outlets.brandId))
    .where(and(status ? eq(orders.status, status) : undefined, search))
    .orderBy(status === "PAID" || status === "PROCESSING" ? asc(orders.paidAt) : desc(orders.createdAt), asc(orders.id)).limit(limit).offset(offset);
  return { orders: rows, total, counts, limit, offset };
}

export async function adminOrderView(id: string) {
  const b = await orderBundle({ id });
  if (!b) throw NOT_FOUND;
  // Guarded admin response. Paths stay internal; file routes use payment/order IDs.
  // paymentProof = bukti bayar pembeli (per payment); orderProof = bukti pesanan di app brand dari admin (per order).
  const order = { ...b.o, orderProofPath: undefined, buyerHash: undefined };
  const attempts = await db.select().from(fulfillmentAttempts).where(eq(fulfillmentAttempts.orderId, id)).orderBy(asc(fulfillmentAttempts.sequence));
  return {
    attempts: attempts.map(({ orderProofPath, ...a }) => ({ ...a, hasOrderProof: !!orderProofPath, proofUrl: orderProofPath ? `/api/admin/files/attempt-proof/${a.id}` : null })),
    order: { ...order, orderProof: { exists: !!b.o.orderProofPath, uploadedAt: b.o.orderProofAt, uploadedBy: b.o.orderProofBy } },
    brand: b.brandName, outlet: b.outletName,
    items: b.items, payments: b.pays.map(({ proofImagePath, ...p }) => ({ ...p, hasProof: !!proofImagePath })), events: b.events,
  };
}

export async function orderAction(id: string, action: string, b: Input, adminId: string) {
  const note = b.optStr("note", 500);
  const isOrderProof = action === "order-proof" || action === "replace-proof"; // replace-proof = alias lama
  const settings = await getSettings();
  const deadline = () => new Date(Date.now() + settings.paymentWindowMin * 60_000);
  // Validate mandatory fields before writing files or opening DB transaction.
  const paidAmount = ["confirm-payment", "reopen"].includes(action) && (action !== "reopen" || b.o.to === "PAID") ? b.int("paidAmount", 0, 2_147_483_647) : null;
  const partnerId = paidAmount !== null ? b.uuid("partnerCompanyId") : null;
  const partnerAmount = paidAmount !== null ? b.int("partnerAmount", 0, 2_147_483_647) : null;
  const reason = ["reject-payment", "fail", "retry-partner"].includes(action) ? b.str("reason", 1, 300) : null;
  const retryPartnerId = action === "retry-partner" ? b.uuid("partnerCompanyId") : null;
  const expectedAttempt = action === "retry-partner" || b.has("attemptId") ? b.uuid("attemptId") : null;
  const refund = action === "set-refund-account" ? {
    method: b.oneOf("method", ["BANK", "EWALLET"] as const), provider: b.str("provider", 2, 40),
    accountNo: b.str("accountNo", 5, 30), accountName: b.str("accountName", 2, 60),
  } : null;
  if (refund && !/^[0-9]+$/.test(refund.accountNo)) throw new ApiError(400, "INVALID_INPUT", "Nomor rekening hanya boleh berisi digit");
  if (["cancel", "reopen", "revert-confirmation", "mark-refunded"].includes(action) && !note) throw new ApiError(400, "INVALID_INPUT", "Catatan wajib");
  // Refund details enter only authenticated admin action; never include them in response or event notes.
  let queueNumber: string | undefined;
  if (action === "start-processing" || (isOrderProof && b.has("queueNumber"))) queueNumber = b.str("queueNumber", 1, 64);
  const file = b.file("file");
  if (action === "start-processing" && !file) throw new ApiError(400, "INVALID_INPUT", "Foto bukti pesanan wajib");
  if (isOrderProof && !file && !queueNumber) throw new ApiError(400, "INVALID_INPUT", "Foto atau nomor antrean wajib");
  const rel = file && (action === "start-processing" || isOrderProof) ? await saveImage(file, "order-proofs") : null;
  let oldPath: string | null = null;
  let committed = false;
  try {
    const result = await locked({ id }, async (tx, o) => {
      const opts = { adminId, note };
      const requireStatus = (allowed: OrderStatus[], already?: OrderStatus[]) => {
        if (already?.includes(o.status)) throw new AlreadyProcessed(o.status);
        if (!allowed.includes(o.status)) throw new ApiError(409, "INVALID_TRANSITION", "Status pesanan sudah berubah", { status: o.status });
      };
      const [attempt] = await tx.select().from(fulfillmentAttempts).where(and(eq(fulfillmentAttempts.orderId, id), sql`${fulfillmentAttempts.closedAt} IS NULL`));
      if (["retry-partner", "start-processing", "order-proof", "replace-proof", "mark-done", "fail", "revert-confirmation"].includes(action)) {
        if ((expectedAttempt && expectedAttempt !== attempt?.id) || (attempt && attempt.sequence > 1 && !expectedAttempt)) {
          throw new ApiError(409, "ATTEMPT_CHANGED", "Percobaan sudah berubah; muat ulang pesanan");
        }
      }
      const archive = async (outcome: "FAILED" | "PAYMENT_CORRECTED", why: string) => {
        if (!attempt) throw new ApiError(409, "ATTEMPT_CHANGED", "Penugasan partner tidak tersedia");
        await tx.update(fulfillmentAttempts).set({ outcome, reason: why, closedAt: new Date(), closedBy: adminId,
          queueNumber: o.queueNumber, orderProofPath: o.orderProofPath, orderProofAt: o.orderProofAt, orderProofBy: o.orderProofBy,
        }).where(eq(fulfillmentAttempts.id, attempt.id));
      };
      if (action === "start-verification") {
        requireStatus(["PROOF_SENT"], ["VERIFYING", "PAID"]);
        const p = await activePayment(tx, id);
        if (!p || p.status !== "PROOF_SENT") throw new ApiError(409, "INVALID_TRANSITION", "Bukti pembayaran belum ada");
        await tx.update(payments).set({ status: "VERIFYING" }).where(eq(payments.id, p.id));
        await transition(tx, o, "VERIFYING", "admin", { ...opts, type: "PAYMENT_CHECK_STARTED" });
      } else if (action === "confirm-payment" || action === "reopen") {
        const to = action === "reopen" ? b.oneOf("to", ["PAID", "REFUND_REQUESTED"] as const) : "PAID";
        requireStatus(action === "reopen" ? ["CANCELLED"] : ["VERIFYING"], ["PAID", "REFUND_REQUESTED"]);
        if (to === "PAID") {
          if (paidAmount === null || paidAmount < o.total) throw new ApiError(422, "UNDERPAID", "Nominal dibayar kurang dari total");
          const [partner] = await tx.select().from(partnerCompanies).where(and(eq(partnerCompanies.id, partnerId!), eq(partnerCompanies.isActive, true))).for("share");
          if (!partner) throw new ApiError(422, "PARTNER_INACTIVE", "Partner tidak aktif");
          const p = await activePayment(tx, id);
          const values = { status: "VERIFIED" as const, paidAmount, verifiedAt: new Date(), verifiedBy: adminId, partnerCompanyId: partnerId, partnerAmount, note };
          if (action === "confirm-payment" && p?.status !== "VERIFYING") throw new ApiError(409, "INVALID_TRANSITION", "Mulai verifikasi lebih dulu");
          if (p) await tx.update(payments).set(values).where(eq(payments.id, p.id));
          else await tx.insert(payments).values({ ...values, orderId: id, expectedAmount: o.total });
          const [last] = await tx.select().from(fulfillmentAttempts).where(eq(fulfillmentAttempts.orderId, id)).orderBy(desc(fulfillmentAttempts.sequence)).limit(1);
          await tx.insert(fulfillmentAttempts).values({ orderId: id, sequence: (last?.sequence ?? 0) + 1,
            partnerCompanyId: partner.id, partnerName: partner.name, partnerAmount, assignedBy: adminId });
        } else {
          // Reopen for refund requires actual amount received, even if fulfilment impossible.
          const received = b.int("paidAmount", 1, 2_147_483_647);
          await tx.insert(payments).values({ orderId: id, expectedAmount: o.total, paidAmount: received, status: "EXPIRED", note });
        }
        await transition(tx, o, to, "admin", { ...opts, type: action === "reopen" ? "PAYMENT_REOPENED" : "PAYMENT_VERIFIED", note: `${note ?? ""}${paidAmount !== null && paidAmount > o.total ? `; kelebihan ${paidAmount - o.total}` : ""}`, set: { paidAt: to === "PAID" ? new Date() : o.paidAt } });
      } else if (action === "reject-payment" || action === "revert-confirmation") {
        requireStatus(action === "reject-payment" ? ["PROOF_SENT", "VERIFYING"] : ["PAID"], ["PENDING_PAYMENT"]);
        if (action === "reject-payment") {
          const p = await activePayment(tx, id);
          if (!p) throw new ApiError(409, "INVALID_TRANSITION", "Pembayaran aktif tidak ada");
          await tx.update(payments).set({ status: "REJECTED", note: reason }).where(eq(payments.id, p.id));
        } else {
          const [failed] = await tx.select({ id: fulfillmentAttempts.id }).from(fulfillmentAttempts).where(and(eq(fulfillmentAttempts.orderId, id), eq(fulfillmentAttempts.outcome, "FAILED"))).limit(1);
          if (failed) throw new ApiError(409, "PAYMENT_CORRECTION_DISABLED", "Proses ulang partner tidak boleh membatalkan pembayaran");
          await archive("PAYMENT_CORRECTED", note!);
          await tx.update(payments).set({ status: "REJECTED", note }).where(and(eq(payments.orderId, id), eq(payments.status, "VERIFIED")));
        }
        await newPendingPayment(tx, o);
        await transition(tx, o, "PENDING_PAYMENT", "admin", { ...opts, type: action === "reject-payment" ? "PAYMENT_REJECTED" : "PAYMENT_CORRECTION", note: reason ?? note, set: { expiresAt: deadline(), paidAt: null } });
      } else if (action === "cancel") {
        requireStatus(["PENDING_PAYMENT", "PROOF_SENT", "VERIFYING"], ["CANCELLED"]);
        await tx.update(payments).set({ status: "REJECTED", note }).where(and(eq(payments.orderId, id), inArray(payments.status, [...ACTIVE_PAYMENT])));
        await transition(tx, o, "CANCELLED", "admin", { ...opts, set: { cancelReason: "ADMIN" } });
      } else if (action === "retry-partner") {
        requireStatus(["PROCESSING"]);
        if (!attempt) throw new ApiError(409, "ATTEMPT_CHANGED", "Penugasan partner tidak tersedia");
        if (retryPartnerId === attempt.partnerCompanyId) throw new ApiError(422, "SAME_PARTNER", "Pilih partner berbeda");
        const [partner] = await tx.select().from(partnerCompanies).where(and(eq(partnerCompanies.id, retryPartnerId!), eq(partnerCompanies.isActive, true))).for("share");
        if (!partner) throw new ApiError(422, "PARTNER_INACTIVE", "Partner tidak aktif atau tidak ditemukan");
        const [verified] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.orderId, id), eq(payments.status, "VERIFIED"))).limit(1);
        if (!verified) throw new ApiError(409, "INVALID_TRANSITION", "Pembayaran belum terverifikasi");
        await archive("FAILED", reason!);
        await tx.insert(fulfillmentAttempts).values({ orderId: id, sequence: attempt.sequence + 1, partnerCompanyId: partner.id, partnerName: partner.name, assignedBy: adminId });
        await transition(tx, o, "PAID", "admin", { ...opts, type: "PARTNER_RETRY", note: reason,
          set: { queueNumber: null, orderProofPath: null, orderProofAt: null, orderProofBy: null } });
      } else if (action === "start-processing") {
        requireStatus(["PAID"], ["PROCESSING", "DONE"]);
        if (!attempt) throw new ApiError(409, "ATTEMPT_CHANGED", "Penugasan partner tidak tersedia");
        oldPath = o.orderProofPath;
        await transition(tx, o, "PROCESSING", "admin", { ...opts, set: { queueNumber, orderProofPath: rel, orderProofAt: new Date(), orderProofBy: adminId } });
      } else if (isOrderProof) {
        // Bukti pesanan di app brand (bukan bukti bayar pembeli). Bisa diunggah sejak PROCESSING, mengganti yang lama.
        requireStatus(["PROCESSING", "DONE"]);
        oldPath = rel ? o.orderProofPath : null;
        await tx.update(orders).set({ ...(queueNumber ? { queueNumber } : {}), ...(rel ? { orderProofPath: rel, orderProofAt: new Date(), orderProofBy: adminId } : {}) }).where(eq(orders.id, id));
        await addEvent(tx, id, o.status, o.status, "ORDER_PROOF_UPLOADED", "admin", adminId, note);
      } else if (action === "mark-done") {
        requireStatus(["PROCESSING"], ["DONE"]);
        await transition(tx, o, "DONE", "admin", opts);
      } else if (action === "fail") {
        requireStatus(["PAID", "PROCESSING"], ["REFUND_REQUESTED"]);
        await archive("FAILED", reason!);
        await transition(tx, o, "REFUND_REQUESTED", "admin", { ...opts, note: reason, set: { queueNumber: null, orderProofPath: null, orderProofAt: null, orderProofBy: null } });
      } else if (action === "set-refund-account") {
        requireStatus(["REFUND_REQUESTED"]);
        await tx.update(orders).set({ refundMethod: refund!.method, refundProvider: refund!.provider, refundAccountNo: refund!.accountNo, refundAccountName: refund!.accountName }).where(eq(orders.id, id));
        await addEvent(tx, id, o.status, o.status, "REFUND_ACCOUNT_SET", "admin", adminId);
      } else if (action === "mark-refunded") {
        requireStatus(["REFUND_REQUESTED"], ["REFUNDED"]);
        if (!o.refundAccountNo) throw new ApiError(422, "REFUND_ACCOUNT_REQUIRED", "Rekening refund belum diisi");
        await transition(tx, o, "REFUNDED", "admin", { ...opts, set: { refundedAt: new Date() } });
      } else throw new ApiError(404, "NOT_FOUND", "Aksi tidak dikenal");
      return { ok: true };
    });
    committed = true;
    if ("alreadyProcessed" in result && rel) await removeStored(rel).catch(() => {});
    if (oldPath) {
      const [archived] = await db.select({ id: fulfillmentAttempts.id }).from(fulfillmentAttempts).where(eq(fulfillmentAttempts.orderProofPath, oldPath)).limit(1);
      if (!archived) await removeStored(oldPath).catch(() => {});
    }
    const bundle = await orderBundle({ id });
    const wa = bundle ? waOrderOf(bundle) : null;
    const waUrl = wa && action === "confirm-payment" ? waConfirmed(wa)
      : wa && action === "reject-payment" ? waRejected(wa, reason!, bundle!.o.expiresAt.toISOString())
      : wa && action === "start-processing" ? waProcessing(wa, bundle!.o.queueNumber!) : null;
    return { ...result, waUrl };
  } catch (e) {
    if (rel && !committed) await removeStored(rel);
    throw e;
  }
}

/** Ringkasan dashboard. range: today | 7d | month (hari Jakarta). Omzet = order terbayar menurut paid_at; hitungan status menurut created_at. */
export async function dashboard(sp: URLSearchParams) {
  const range = new Input(Object.fromEntries(sp)).has("range") ? new Input(Object.fromEntries(sp)).oneOf("range", ["today", "7d", "month"] as const) : "today";
  const day = sql`date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta')`;
  const from = range === "today" ? day : range === "7d" ? sql`${day} - interval '6 days'` : sql`date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')`;
  const local = (c: unknown) => sql`(${c} AT TIME ZONE 'Asia/Jakarta')`;
  const [rev] = await db.select({ revenue: sql<number>`coalesce(sum(${orders.total}), 0)::int`, paidCount: sql<number>`count(*)::int` }).from(orders)
    .where(and(inArray(orders.status, ["PAID", "PROCESSING", "DONE"]), sql`${local(orders.paidAt)} >= ${from}`));
  const byStatus = Object.fromEntries((await db.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders)
    .where(sql`${local(orders.createdAt)} >= ${from}`).groupBy(orders.status)).map(r => [r.status, r.n]));
  const n = (k: string) => (byStatus[k] as number | undefined) ?? 0;
  return {
    range, revenue: rev.revenue, paidCount: rev.paidCount,
    unpaid: { total: n("PENDING_PAYMENT") + n("PROOF_SENT") + n("VERIFYING"), awaitingProof: n("PENDING_PAYMENT"), needsCheck: n("PROOF_SENT") + n("VERIFYING") },
    processing: { total: n("PAID") + n("PROCESSING"), orderedToPartner: n("PAID"), inProgress: n("PROCESSING") },
    done: n("DONE"), byStatus,
  };
}
