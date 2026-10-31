import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments, paymentAccounts } from "@/db/schema";
import { requireAdmin } from "@/server/admin-auth";
import { fileResponse } from "@/server/files";
import { handle, isUuid, NOT_FOUND } from "@/server/http";
export const GET = handle<{ params: Promise<{ kind: string; id: string }> }>(async (req, { params }) => {
  await requireAdmin(req);
  const { kind, id } = await params;
  if (!isUuid(id)) throw NOT_FOUND;
  let rel: string | null = null;
  if (kind === "payment-proof") {
    const [p] = await db.select().from(payments).where(eq(payments.id, id)).orderBy(desc(payments.createdAt)).limit(1);
    rel = p?.proofImagePath ?? null;
  } else if (kind === "order-proof") {
    const [o] = await db.select().from(orders).where(eq(orders.id, id));
    rel = o?.proofImagePath ?? null;
  } else if (kind === "qris") {
    const [a] = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, id));
    rel = a?.qrisImagePath ?? null;
  }
  const response = await fileResponse(rel);
  if (!response) throw NOT_FOUND;
  return response;
});
