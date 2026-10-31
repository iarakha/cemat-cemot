// Konfigurasi toko dari DB (bukan env): nomor WA admin dan tujuan bayar aktif.
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { partnerCompanies, paymentAccounts, storeSettings } from "@/db/schema";

export async function getAdminWa() {
  const [row] = await db.select({ wa: storeSettings.adminWa }).from(storeSettings).where(eq(storeSettings.id, 1));
  return row?.wa ?? null;
}

// Tujuan bayar aktif pertama (v1: satu QRIS_STATIC). Path gambar relatif ke UPLOAD_DIR; layani lewat route handler.
export async function getActivePaymentAccount() {
  const [row] = await db.select().from(paymentAccounts)
    .where(and(eq(paymentAccounts.isActive, true), eq(paymentAccounts.type, "QRIS_STATIC"))).orderBy(asc(paymentAccounts.sortOrder)).limit(1);
  return row ?? null;
}

// Tautan wa.me (BR-35). Nomor format 62...; teks di-encode.
export const waLink = (wa: string, text: string) => `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;

// Status toko. Hanya OPEN yang menerima checkout; lainnya tampil sebagai banner ke pembeli.
export const STORE_STATUS_LABEL = {
  OPEN: "Buka", CLOSED: "Tutup", BREAK: "Istirahat", PRAYER: "Solat", LEAVE: "Cuti",
} as const satisfies Record<(typeof storeSettings.$inferSelect)["status"], string>;

export async function getStoreStatus() {
  const [row] = await db.select({ status: storeSettings.status, message: storeSettings.closedMessage })
    .from(storeSettings).where(eq(storeSettings.id, 1));
  return row ?? { status: "CLOSED" as const, message: null };
}

// Partner aktif untuk dipilih admin saat verifikasi pembayaran.
export const getActivePartners = () =>
  db.select().from(partnerCompanies).where(eq(partnerCompanies.isActive, true)).orderBy(asc(partnerCompanies.name));
