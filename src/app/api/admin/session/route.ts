import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { createAdminSession, clearCookie, requireAdmin, revokeSession, sessionCookie, verifyPassword } from "@/server/admin-auth";
import { ApiError, assertSameOrigin, clientIp, handle, Input, json } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

export const GET = handle(async (req) => {
  const a = await requireAdmin(req);
  return json({ id: a.id, username: a.username, email: a.email });
});
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  const b = await Input.json(req);
  const username = b.str("username", 3, 32).toLowerCase();
  const password = b.o.password;
  if (typeof password !== "string" || password.length > 1024) throw new ApiError(400, "INVALID_INPUT", "Password tidak valid");
  await rateLimit("login-ip", clientIp(req), 5, 900);
  await rateLimit("login-user", username, 5, 900);
  const start = Date.now();
  const [a] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
  const valid = verifyPassword(password, a?.passwordHash ?? null);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - start))));
  if (!valid || !a) throw new ApiError(401, "INVALID_CREDENTIALS", "Username atau password salah");
  const s = await createAdminSession(a.id);
  return Response.json({ id: a.id, username: a.username, email: a.email }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(s.token, s.expiresAt) },
  });
});
export const DELETE = handle(async (req) => {
  const a = await requireAdmin(req);
  await revokeSession(a.tokenHash);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearCookie(), "Cache-Control": "no-store" } });
});
