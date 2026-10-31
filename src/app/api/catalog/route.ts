import { getCatalog } from "@/lib/catalog";
import { getMenuOptions } from "@/lib/menu-options";
import { handle, json } from "@/server/http";

// Katalog aktif per brand beserta opsi per menu. Harga akhir tetap dihitung server saat checkout (BR-03).
export const GET = handle(async () => {
  const brands = await getCatalog();
  const out = await Promise.all(brands.map(async (b) => ({
    ...b, items: await Promise.all(b.items.map(async (i) => ({ ...i, options: await getMenuOptions(i.id) }))),
  })));
  return json({ brands: out });
});
