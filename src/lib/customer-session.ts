import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { customerSessions, orders } from "@/db/schema";
import { historyPage, normalizePhone } from "./order-rules";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-cc_customer" : "cc_customer";
const MAX_AGE = 3 * 60 * 60;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// Hanya panggil setelah OTP berhasil; input checkout bukan bukti kepemilikan nomor.
export async function createVerifiedCustomerSession(phone: string) {
  const customerPhone = normalizePhone(phone);
  const jar = await cookies();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + MAX_AGE * 1000);
  const oldToken = jar.get(COOKIE)?.value;
  await db.transaction(async (tx) => {
    if (oldToken) await tx.delete(customerSessions).where(eq(customerSessions.tokenHash, hash(oldToken)));
    await tx.insert(customerSessions).values({ customerPhone, tokenHash: hash(token), expiresAt });
  });
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE, expires: expiresAt });
}

export async function getCustomerSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [session] = await db.select({ customerPhone: customerSessions.customerPhone })
    .from(customerSessions).where(and(eq(customerSessions.tokenHash, hash(token)), gt(customerSessions.expiresAt, new Date()))).limit(1);
  return session ?? null;
}

export async function getCustomerHistory(limit = 10, offset = 0) {
  const page = historyPage(limit, offset);
  const session = await getCustomerSession();
  if (!session) throw new Error("OTP_REQUIRED");
  return db.select({ id: orders.id, orderCode: orders.orderCode, status: orders.status, total: orders.total, createdAt: orders.createdAt })
    .from(orders).where(eq(orders.customerPhone, session.customerPhone))
    .orderBy(desc(orders.createdAt), desc(orders.id)).limit(page.limit).offset(page.offset);
}

// Panggil terpisah untuk IP dan nomor ter-HMAC, sebelum pencarian/pengiriman OTP.
export async function consumeLookupLimit(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid rate limit key");
  const result = await db.execute(sql`
    INSERT INTO request_limits (key, count, reset_at) VALUES (${key}, 1, now() + interval '15 minutes')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN request_limits.reset_at <= now() THEN 1 ELSE request_limits.count + 1 END,
      reset_at = CASE WHEN request_limits.reset_at <= now() THEN now() + interval '15 minutes' ELSE request_limits.reset_at END
    WHERE request_limits.reset_at <= now() OR request_limits.count < 5
    RETURNING count, reset_at`);
  return result.length > 0;
}
