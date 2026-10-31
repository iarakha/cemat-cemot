// Pengaturan toko + gerbang checkout (BR-08, EC-06: semua jam Asia/Jakarta).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { storeSettings } from "@/db/schema";
import { getActivePaymentAccount } from "@/lib/config";
import { ApiError } from "./http";

export async function getSettings() {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.id, 1));
  if (!row) throw new ApiError(503, "NOT_CONFIGURED", "Pengaturan toko belum ada");
  return row;
}

/** Waktu dinding Asia/Jakarta: tanggal (YYYY-MM-DD) dan menit sejak 00:00. */
export function jakartaNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMin = (t: string) => { const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };

/** Lempar 422 STORE_CLOSED / CHECKOUT_CUTOFF / PAYMENT_NOT_READY bila checkout tidak boleh. */
export async function assertCheckoutOpen(settings: Awaited<ReturnType<typeof getSettings>>, now = new Date()) {
  const { minutes } = jakartaNow(now);
  const open = toMin(settings.openAt), close = toMin(settings.closeAt);
  if (settings.status !== "OPEN" || minutes < open || minutes >= close) {
    throw new ApiError(422, "STORE_CLOSED", settings.closedMessage ?? "Toko sedang tutup");
  }
  if (close - minutes < settings.checkoutCutoffMin) {
    throw new ApiError(422, "CHECKOUT_CUTOFF", "Terlalu dekat jam tutup, admin tidak sempat memverifikasi");
  }
  if (!settings.adminWa) throw new ApiError(422, "PAYMENT_NOT_READY", "Nomor WA admin belum diisi");
  if (!(await getActivePaymentAccount())) throw new ApiError(422, "PAYMENT_NOT_READY", "Belum ada tujuan pembayaran aktif");
}
