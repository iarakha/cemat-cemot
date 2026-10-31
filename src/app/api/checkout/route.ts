import { checkout } from "@/server/order-flow";
import { assertSameOrigin, clientIp, handle, Input, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

// API-02. Header Idempotency-Key (EC-02) dipakai bila body tidak membawa idempotencyKey.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await rateLimit("checkout-ip", clientIp(req), 20, 600);
  const body = await Input.json(req);
  const hdr = req.headers.get("idempotency-key");
  if (hdr && !body.has("idempotencyKey")) body.o.idempotencyKey = hdr;
  const r = await checkout(body);
  return json({ token: r.token }, r.replay ? 200 : 201);
});
