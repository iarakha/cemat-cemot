import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentAccounts } from "@/db/schema";
import { isUuid, handle, NOT_FOUND } from "@/server/http";
import { fileResponse } from "@/server/files";

// API-09: gambar QRIS hanya untuk tujuan aktif.
export const GET = handle<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params;
  if (!isUuid(id)) throw NOT_FOUND;
  const [a] = await db.select({ p: paymentAccounts.qrisImagePath }).from(paymentAccounts)
    .where(and(eq(paymentAccounts.id, id), eq(paymentAccounts.isActive, true), eq(paymentAccounts.type, "QRIS_STATIC")));
  return (await fileResponse(a?.p)) ?? Response.json({ error: { code: "NOT_FOUND", message: "Tidak ditemukan" } }, { status: 404 });
});
