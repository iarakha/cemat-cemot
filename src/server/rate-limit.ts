import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { requestLimits } from "@/db/schema";
import { ApiError, hmac } from "./http";

/** Rate limit atomik di DB (tabel request_limits). Kunci = HMAC(scope:id), tidak menyimpan IP/HP mentah. Lempar 429 + Retry-After. */
export async function rateLimit(scope: string, id: string, max: number, windowSec: number) {
  const key = hmac(`${scope}:${id}`);
  const hit = await db.execute(sql`
    INSERT INTO request_limits (key, count, reset_at) VALUES (${key}, 1, now() + ${windowSec} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN request_limits.reset_at <= now() THEN 1 ELSE request_limits.count + 1 END,
      reset_at = CASE WHEN request_limits.reset_at <= now() THEN now() + ${windowSec} * interval '1 second' ELSE request_limits.reset_at END
    WHERE request_limits.reset_at <= now() OR request_limits.count < ${max}
    RETURNING count`);
  if (hit.length > 0) return;
  const [row] = await db.select({ resetAt: requestLimits.resetAt }).from(requestLimits).where(eq(requestLimits.key, key));
  const retry = Math.max(1, Math.ceil(((row?.resetAt.getTime() ?? Date.now() + 1000) - Date.now()) / 1000));
  throw new ApiError(429, "RATE_LIMITED", "Terlalu banyak percobaan, coba lagi nanti", { retryAfter: retry }, { "Retry-After": String(retry) });
}
