import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, outlets, brands } from "@/db/schema";
import { getCustomerSession } from "@/lib/customer-session";
import { normalizePhone } from "@/lib/order-rules";
import { assertSameOrigin, bad, clientIp, handle, Input, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await rateLimit("lookup-ip", clientIp(req), 5, 900);
  const b = await Input.json(req);
  const type = b.oneOf("type", ["phone", "booking", "pickup"] as const);
  let value = b.str("value", 1, 64);
  if (type === "phone") {
    try { value = normalizePhone(value); } catch { throw bad("value", "Nomor tidak valid"); }
  }
  const session = await getCustomerSession();
  if (!session) {
    // No selected provider: never disclose whether an order matches; opaque random challenge carries no order data.
    return json({ verificationRequired: true, challenge: randomBytes(32).toString("base64url"), otpAvailable: false }, 202);
  }
  await rateLimit("lookup-phone", session.customerPhone, 5, 900);
  const cond = type === "phone" ? eq(orders.customerPhone, value) : type === "booking" ? eq(orders.orderCode, value) : eq(orders.queueNumber, value);
  const brand = b.optStr("brand", 40);
  const outlet = b.has("outletId") ? b.uuid("outletId") : null;
  const rows = await db.select({ token: orders.trackingToken, orderCode: orders.orderCode, status: orders.status, createdAt: orders.createdAt })
    .from(orders).innerJoin(outlets, eq(outlets.id, orders.outletId)).innerJoin(brands, eq(brands.id, outlets.brandId))
    .where(and(eq(orders.customerPhone, session.customerPhone), cond, brand ? eq(brands.slug, brand) : undefined, outlet ? eq(outlets.id, outlet) : undefined))
    .orderBy(desc(orders.createdAt), desc(orders.id)).limit(50);
  return json({ orders: rows });
});
