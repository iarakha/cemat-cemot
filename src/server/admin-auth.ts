// SC-05/06/11: sesi admin. Cookie acak 32 byte httpOnly; DB menyimpan SHA-256-nya. Password scrypt.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { ApiError, assertSameOrigin } from "./http";

export const ADMIN_COOKIE = process.env.NODE_ENV === "production" ? "__Host-cc_admin" : "cc_admin";
export const SESSION_SEC = 12 * 60 * 60;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}
// Hash palsu agar waktu verifikasi sama untuk username yang tidak ada (pesan generik SC-06).
const DUMMY = hashPassword("dummy-password-for-timing");
export function verifyPassword(password: string, stored: string | null) {
  const [scheme, saltHex, hashHex] = (stored ?? DUMMY).split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected) && stored !== null;
}

export async function createAdminSession(adminId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SEC * 1000);
  await db.insert(adminSessions).values({ adminId, tokenHash: sha(token), expiresAt });
  return { token, expiresAt };
}

export const sessionCookie = (token: string, expiresAt: Date) =>
  `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SEC}; Expires=${expiresAt.toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
export const clearCookie = () =>
  `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Guard semua rute admin. Mutasi (non-GET) juga cek Origin. 401 tanpa sesi valid. */
export async function requireAdmin(req: Request) {
  if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, "UNAUTHORIZED", "Perlu masuk");
  const [row] = await db.select({ id: adminUsers.id, username: adminUsers.username, email: adminUsers.email, tokenHash: adminSessions.tokenHash })
    .from(adminSessions).innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, sha(token)), gt(adminSessions.expiresAt, new Date()))).limit(1);
  if (!row) throw new ApiError(401, "UNAUTHORIZED", "Perlu masuk");
  return row;
}

export const revokeAllSessions = (tx: Pick<typeof db, "delete">, adminId: string) =>
  tx.delete(adminSessions).where(eq(adminSessions.adminId, adminId));
export const revokeSession = (tokenHash: string) => db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
