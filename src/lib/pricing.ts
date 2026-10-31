export const rupiah = (n: number) => "Rp" + new Intl.NumberFormat("id-ID").format(n);

/** Persen hemat untuk badge: dibulatkan ke bawah agar tidak melebih-lebihkan; null jika promo tidak lebih murah. */
export function savingPercent(normalPrice: number, promoPrice: number): number | null {
  if (normalPrice <= 0 || promoPrice <= 0 || promoPrice >= normalPrice) return null;
  const pct = Math.floor(((normalPrice - promoPrice) * 100) / normalPrice);
  return pct > 0 ? pct : null;
}

/** BR-04: harga satuan = harga promo (jika lebih murah dari normal) atau normal, + delta opsi (promo tidak berlaku ke delta). */
export function unitPrice(normalPrice: number, promoPrice: number | null, optionDeltas: number[]): number {
  const base = promoPrice !== null && promoPrice > 0 && promoPrice < normalPrice ? promoPrice : normalPrice;
  return Math.max(0, base + optionDeltas.reduce((a, b) => a + b, 0));
}

export type OptionGroup = {
  id: string; name: string; required: boolean; maxSelect: number;
  choices: { id: string; label: string; priceDelta: number; isDefault: boolean }[];
};

/** BR-03: validasi pilihan pembeli di server terhadap opsi menu. Tidak ada default diam-diam: grup wajib harus dipilih. */
export function resolveOptions(groups: OptionGroup[], selectedIds: string[]) {
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error("Pilihan opsi duplikat");
  const known = new Set(groups.flatMap((g) => g.choices.map((c) => c.id)));
  if (selectedIds.some((id) => !known.has(id))) throw new Error("Pilihan opsi tidak berlaku untuk menu ini");
  const picked = new Set(selectedIds);
  const snapshot: { group: string; label: string; priceDelta: number }[] = [];
  for (const g of groups) {
    const chosen = g.choices.filter((c) => picked.has(c.id));
    if (chosen.length > g.maxSelect) throw new Error(`Opsi ${g.name}: maksimal ${g.maxSelect} pilihan`);
    if (g.required && chosen.length === 0) throw new Error(`Opsi ${g.name} wajib dipilih`);
    for (const c of chosen) snapshot.push({ group: g.name, label: c.label, priceDelta: c.priceDelta });
  }
  return { snapshot, deltas: snapshot.map((s) => s.priceDelta) }; // snapshot cocok dengan order_items.options_snapshot
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
