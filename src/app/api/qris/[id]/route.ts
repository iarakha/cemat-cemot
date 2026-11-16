import { and, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentAccounts, payments } from "@/db/schema";
import { isUuid, handle, NOT_FOUND } from "@/server/http";
import { fileResponse } from "@/server/files";

// API-09: enabled QRIS is public; disabled QRIS only for an active payment assigned to that order.
export const GET = handle<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  if (!isUuid(id)) throw NOT_FOUND;
  const enabled = await db.select({ p: paymentAccounts.qrisImagePath }).from(paymentAccounts)
    .where(and(eq(paymentAccounts.id, id), eq(paymentAccounts.isActive, true), eq(paymentAccounts.type, "QRIS_STATIC")));
  const token = new URL(_req.url).searchParams.get("token") ?? "";
  const assigned = enabled.length || !/^[A-Za-z0-9_-]{22}$/.test(token) ? [] : await db.select({ p: paymentAccounts.qrisImagePath }).from(paymentAccounts)
    .innerJoin(payments, eq(payments.paymentAccountId, paymentAccounts.id))
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(paymentAccounts.id, id), eq(paymentAccounts.type, "QRIS_STATIC"), eq(orders.trackingToken, token), or(inArray(orders.status, ["PROOF_SENT", "VERIFYING"]), and(eq(orders.status, "PENDING_PAYMENT"), gt(orders.expiresAt, new Date()))), inArray(payments.status, ["PENDING", "PROOF_SENT", "VERIFYING"])));
  const a = enabled[0] ?? assigned[0];
  return (await fileResponse(a?.p)) ?? Response.json({ error: { code: "NOT_FOUND", message: "Tidak ditemukan" } }, { status: 404 });
});
