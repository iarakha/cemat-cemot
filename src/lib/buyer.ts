// Identitas perangkat pembeli tanpa login: cookie acak, DB hanya simpan SHA-256. Dasar riwayat pesanan; cookie dibuat saat checkout.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = process.env.NODE_ENV === "production" ? "__Host-cc_buyer" : "cc_buyer";
const MAX_AGE = 180 * 24 * 60 * 60;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** create=true: buat cookie bila belum ada. Tanpa cookie dan create=false -> null. */
export async function getBuyerHash(create = false): Promise<string | null> {
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (!create) return null;
    token = randomBytes(32).toString("base64url");
  }
  if (create) jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
  return hash(token);
}
