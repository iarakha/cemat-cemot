import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { fileResponse } from "@/server/files";
import { handle, NOT_FOUND } from "@/server/http";
import { isToken } from "@/server/order-flow";

// API-08: payment-proof (bukti bayar pembeli) atau order-proof (foto dari admin). Hanya pemilik token.
export const GET = handle<{ params: Promise<{ token: string; kind: string }> }>(async (_req, { params }) => {
  const { token, kind } = await params;
  if (!isToken(token) || (kind !== "payment-proof" && kind !== "order-proof")) throw NOT_FOUND;
  const [o] = await db.select({ id: orders.id, proof: orders.proofImagePath }).from(orders).where(eq(orders.trackingToken, token));
  if (!o) throw NOT_FOUND;
  let rel = o.proof;
  if (kind === "payment-proof") {
    const [p] = await db.select({ p: payments.proofImagePath }).from(payments).where(eq(payments.orderId, o.id)).orderBy(desc(payments.proofClaimedAt)).limit(1);
    rel = p?.p ?? null;
  }
  return (await fileResponse(rel)) ?? Response.json({ error: { code: "NOT_FOUND", message: "Tidak ditemukan" } }, { status: 404 });
});
