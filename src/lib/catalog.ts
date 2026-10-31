import { connection } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, menuItems, promoPrices } from "@/db/schema";
import { savingPercent } from "./pricing";

export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  normalPrice: number;
  promo: { final: number; savingPercent: number } | null; // untuk badge "Hemat X%"
};
export type CatalogBrand = {
  id: string;
  slug: string;
  name: string;
  accentColor: string;
  items: CatalogItem[];
};

/** Katalog aktif + harga promo (promo_prices) per menu. */
export async function getCatalog(): Promise<CatalogBrand[]> {
  await connection(); // harga bisa berubah dari admin: render per request
  const [bs, items, ps] = await Promise.all([
    db.select().from(brands).where(eq(brands.isActive, true)).orderBy(asc(brands.sortOrder)),
    db.select().from(menuItems).where(eq(menuItems.isAvailable, true)).orderBy(asc(menuItems.category), asc(menuItems.name)),
    db.select().from(promoPrices),
  ]);

  return bs.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    accentColor: b.accentColor,
    items: items
      .filter((i) => i.brandId === b.id)
      .map((i) => {
        const pp = ps.find((p) => p.menuItemId === i.id);
        const pct = pp ? savingPercent(i.normalPrice, pp.promoPrice) : null;
        return {
          id: i.id,
          name: i.name,
          category: i.category,
          normalPrice: i.normalPrice,
          promo: pp && pct ? { final: pp.promoPrice, savingPercent: pct } : null,
        };
      }),
  }));
}
