export type PromoType = "PERCENT" | "AMOUNT_OFF" | "FIXED_PRICE";
export type PromoLike = { type: PromoType; value: number };

export const rupiah = (n: number) => "Rp" + new Intl.NumberFormat("id-ID").format(n);

/** Harga setelah satu promo; tidak pernah di bawah 0 atau di atas harga normal. */
export function applyPromo(price: number, p: PromoLike): number {
  const v =
    p.type === "PERCENT" ? Math.round((price * (100 - p.value)) / 100)
    : p.type === "AMOUNT_OFF" ? price - p.value
    : p.value;
  return Math.min(price, Math.max(0, v));
}

/** Promo terbaik (harga akhir terendah) dari kandidat; null jika tidak ada yang menurunkan harga. */
export function bestPromo<T extends PromoLike>(price: number, promos: T[]) {
  let best: { promo: T; final: number } | null = null;
  for (const promo of promos) {
    const final = applyPromo(price, promo);
    if (final < price && (!best || final < best.final)) best = { promo, final };
  }
  return best;
}

/** BR-04: harga satuan = promo pada harga dasar + delta opsi (promo tidak berlaku ke delta). */
export function unitPrice(normalPrice: number, promos: PromoLike[], optionDeltas: number[]): number {
  const base = bestPromo(normalPrice, promos)?.final ?? normalPrice;
  return Math.max(0, base + optionDeltas.reduce((a, b) => a + b, 0));
}

/** BR-06: total = subtotal + fee jasa + kode unik. */
export const orderTotal = (lines: { unitPrice: number; qty: number }[], serviceFee: number, uniqueCode: number) =>
  lines.reduce((a, l) => a + l.unitPrice * l.qty, 0) + serviceFee + uniqueCode;

/** BR-24: kode unik acak 1-99 yang belum dipakai order aktif; null jika 99 kode habis (checkout -> 503). */
export function pickUniqueCode(taken: Iterable<number>, rand: () => number = Math.random): number | null {
  const used = new Set(taken);
  const free = Array.from({ length: 99 }, (_, i) => i + 1).filter((c) => !used.has(c));
  return free.length ? free[Math.floor(rand() * free.length)] : null;
}
