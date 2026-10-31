export const ORDER_PHASES = [
  ["PENDING_PAYMENT", "Menunggu pembayaran"],
  ["PROOF_SENT", "Bukti dikirim"],
  ["VERIFYING", "Verifikasi pembayaran"],
  ["PAID", "Menunggu diproses"],
  ["PROCESSING", "Diproses"],
  ["READY", "Siap diambil"],
  ["DONE", "Selesai"],
] as const;

export function normalizePhone(input: string): string {
  if (typeof input !== "string" || !/^(?:08\d{8,11}|628\d{8,11})$/.test(input)) {
    throw new Error("Nomor HP harus diawali 08 atau 628, panjang lokal 10–13 digit");
  }
  return input.startsWith("0") ? "62" + input.slice(1) : input;
}

const INITIALS: Record<string, string> = {
  fore: "F", "kopi-kenangan": "K", cotti: "C", "janji-jiwa": "J", tomoro: "T",
};

export function bookingCode(day: string, sequence: number, brandSlug: string): string {
  const date = new Date(day + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== day || !Number.isSafeInteger(sequence) || sequence < 1 || !INITIALS[brandSlug]) {
    throw new Error("Data kode booking tidak valid");
  }
  return `CC${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}${String(sequence).padStart(4, "0")}${INITIALS[brandSlug]}`;
}

export function historyPage(limit = 10, offset = 0) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Pagination tidak valid");
  }
  return { limit, offset };
}
