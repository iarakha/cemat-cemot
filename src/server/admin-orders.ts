import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, partnerCompanies } from "@/db/schema";
import { ApiError, Input, NOT_FOUND } from "./http";
import { removeStored, saveImage } from "./files";
import { getSettings } from "./store";
import { ACTIVE_PAYMENT, AlreadyProcessed, activePayment, addEvent, locked, newPendingPayment, orderBundle, transition, waOrderOf, type OrderStatus } from "./order-flow";
import { waConfirmed, waReady, waRejected } from "./wa";

export async function listOrders(sp: URLSearchParams) {
  const b = new Input(Object.fromEntries(sp));
  const limit = b.has("limit") ? b.int("limit", 1, 50) : 20;
  const offset = b.has("offset") ? b.int("offset", 0, 1_000_000) : 0;
  const status = b.has("status") ? b.oneOf("status", ["PENDING_PAYMENT", "PROOF_SENT", "VERIFYING", "PAID", "PROCESSING", "READY", "DONE", "REFUND_REQUESTED", "REFUNDED", "CANCELLED"] as const) : null;
  const rows = await db.select({ id: orders.id, orderCode: orders.orderCode, status: orders.status, customerName: orders.customerName, total: orders.total, createdAt: orders.createdAt, paidAt: orders.paidAt })
    .from(orders).where(status ? eq(orders.status, status) : undefined)
    .orderBy(status === "PAID" || status === "PROCESSING" ? asc(orders.paidAt) : desc(orders.createdAt), asc(orders.id)).limit(limit).offset(offset);
  return { orders: rows, limit, offset };
}

export async function adminOrderView(id: string) {
  const b = await orderBundle({ id });
  if (!b) throw NOT_FOUND;
  // Guarded admin response. Paths stay internal; file routes use payment/order IDs.
  return {
    order: { ...b.o, proofImagePath: undefined }, brand: b.brandName, outlet: b.outletName,
    items: b.items, payments: b.pays.map((p) => ({ ...p, proofImagePath: undefined, hasProof: !!p.proofImagePath })), events: b.events,
  };
}

export async function orderAction(id: string, action: string, b: Input, adminId: string) {
  const note = b.optStr("note", 500);
  const settings = await getSettings();
  const deadline = () => new Date(Date.now() + settings.paymentWindowMin * 60_000);
  // Validate mandatory fields before writing files or opening DB transaction.
  const paidAmount = ["confirm-payment", "reopen"].includes(action) && (action !== "reopen" || b.o.to === "PAID") ? b.int("paidAmount", 0, 2_147_483_647) : null;
  const partnerId = paidAmount !== null ? b.uuid("partnerCompanyId") : null;
  const partnerAmount = paidAmount !== null ? b.int("partnerAmount", 0, 2_147_483_647) : null;
  const reason = ["reject-payment", "fail"].includes(action) ? b.str("reason", 1, 300) : null;
  if (["cancel", "reopen", "revert-confirmation", "mark-refunded"].includes(action) && !note) throw new ApiError(400, "INVALID_INPUT", "Catatan wajib");
  let queueNumber: string | undefined;
  if (action === "mark-ready" || (action === "replace-proof" && b.has("queueNumber"))) queueNumber = b.str("queueNumber", 1, 64);
  const file = b.file("file");
  if (action === "mark-ready" && !file) throw new ApiError(400, "INVALID_INPUT", "Foto bukti pesanan wajib");
  if (action === "replace-proof" && !file && !queueNumber) throw new ApiError(400, "INVALID_INPUT", "Foto atau nomor antrian wajib");
  const rel = file && ["mark-ready", "replace-proof"].includes(action) ? await saveImage(file, "order-proofs") : null;
  let oldPath: string | null = null;
  let committed = false;
  try {
    const result = await locked({ id }, async (tx, o) => {
      const opts = { adminId, note };
      const requireStatus = (allowed: OrderStatus[], already?: OrderStatus[]) => {
        if (already?.includes(o.status)) throw new AlreadyProcessed(o.status);
        if (!allowed.includes(o.status)) throw new ApiError(409, "INVALID_TRANSITION", "Status pesanan sudah berubah", { status: o.status });
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
          await tx.update(payments).set({ status: "REJECTED", note }).where(and(eq(payments.orderId, id), eq(payments.status, "VERIFIED")));
        }
        await newPendingPayment(tx, o);
        await transition(tx, o, "PENDING_PAYMENT", "admin", { ...opts, type: action === "reject-payment" ? "PAYMENT_REJECTED" : "PAYMENT_CORRECTION", note: reason ?? note, set: { expiresAt: deadline(), paidAt: null } });
      } else if (action === "cancel") {
        requireStatus(["PENDING_PAYMENT", "PROOF_SENT", "VERIFYING"], ["CANCELLED"]);
        await tx.update(payments).set({ status: "REJECTED", note }).where(and(eq(payments.orderId, id), inArray(payments.status, [...ACTIVE_PAYMENT])));
        await transition(tx, o, "CANCELLED", "admin", { ...opts, set: { cancelReason: "ADMIN" } });
      } else if (action === "start-processing") {
        requireStatus(["PAID"], ["PROCESSING"]);
        await transition(tx, o, "PROCESSING", "admin", opts);
      } else if (action === "mark-ready") {
        requireStatus(["PROCESSING"], ["READY"]);
        oldPath = o.proofImagePath;
        await transition(tx, o, "READY", "admin", { ...opts, set: { queueNumber, proofImagePath: rel } });
      } else if (action === "replace-proof") {
        requireStatus(["PROCESSING", "READY", "DONE"]);
        oldPath = rel ? o.proofImagePath : null;
        await tx.update(orders).set({ ...(queueNumber ? { queueNumber } : {}), ...(rel ? { proofImagePath: rel } : {}) }).where(eq(orders.id, id));
        await addEvent(tx, id, o.status, o.status, "ORDER_PROOF_UPLOADED", "admin", adminId, note);
      } else if (action === "mark-done") {
        requireStatus(["READY"], ["DONE"]);
        await transition(tx, o, "DONE", "admin", opts);
      } else if (action === "fail") {
        requireStatus(["PAID", "PROCESSING", "READY"], ["REFUND_REQUESTED"]);
        await transition(tx, o, "REFUND_REQUESTED", "admin", { ...opts, note: reason });
      } else if (action === "mark-refunded") {
        requireStatus(["REFUND_REQUESTED"], ["REFUNDED"]);
        if (!o.refundAccountNo) throw new ApiError(422, "REFUND_ACCOUNT_REQUIRED", "Rekening refund belum diisi");
        await transition(tx, o, "REFUNDED", "admin", { ...opts, set: { refundedAt: new Date() } });
      } else throw new ApiError(404, "NOT_FOUND", "Aksi tidak dikenal");
      return { ok: true };
    });
    committed = true;
    if ("alreadyProcessed" in result && rel) await removeStored(rel).catch(() => {});
    if (oldPath) await removeStored(oldPath).catch(() => {});
    const bundle = await orderBundle({ id });
    const wa = bundle ? waOrderOf(bundle) : null;
    const waUrl = wa && action === "confirm-payment" ? waConfirmed(wa)
      : wa && action === "reject-payment" ? waRejected(wa, reason!, bundle!.o.expiresAt.toISOString())
      : wa && action === "mark-ready" ? waReady(wa, bundle!.o.queueNumber!) : null;
    return { ...result, waUrl };
  } catch (e) {
    if (rel && !committed) await removeStored(rel);
    throw e;
  }
}
