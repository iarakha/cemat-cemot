import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { clearCookie, hashPassword, requireAdmin, revokeAllSessions, verifyPassword } from "@/server/admin-auth";
import { ApiError, bad, clientIp, handle, Input } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

// Own-account only. Identity/password changes atomically revoke every session including current one.
export const PATCH = handle(async (req) => {
  const admin = await requireAdmin(req);
  await rateLimit("profile-ip", clientIp(req), 5, 900);
  await rateLimit("profile-admin", admin.id, 5, 900);
  const b = await Input.json(req);
  const current = b.o.currentPassword;
  if (typeof current !== "string" || current.length > 1024) throw bad("currentPassword", "Password saat ini wajib");
  const mode = b.oneOf("action", ["identity", "password"] as const);
  await db.transaction(async tx => {
    const [old] = await tx.select().from(adminUsers).where(eq(adminUsers.id, admin.id)).for("update");
    if (!old || !verifyPassword(current, old.passwordHash)) throw new ApiError(403, "INVALID_PASSWORD", "Password saat ini salah");
    if (mode === "identity") {
      const username = b.str("username", 3, 32).toLowerCase();
      const email = b.str("email", 3, 254).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) throw bad("username", "Format username tidak valid");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("email", "Email tidak valid");
      await tx.update(adminUsers).set({ username, email }).where(eq(adminUsers.id, admin.id));
    } else {
      const password = b.o.newPassword;
      if (typeof password !== "string" || password.length < 8 || password.length > 128 || password !== b.o.confirmation) throw bad("newPassword", "Password 8–128 karakter dan konfirmasi sama wajib");
      await tx.update(adminUsers).set({ passwordHash: hashPassword(password) }).where(eq(adminUsers.id, admin.id));
    }
    await revokeAllSessions(tx, admin.id);
  });
  return Response.json({ loginRequired: true }, { headers: { "Set-Cookie": clearCookie(), "Cache-Control": "no-store" } });
});
