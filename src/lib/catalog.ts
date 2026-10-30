import { connection } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { brands, menuItems, promos } from "@/db/schema";
import { bestPromo } from "./pricing";

export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  normalPrice: number;
  promo: { title: string; final: number } | null;
};
export type CatalogBrand = {
  id: string;
  slug: string;
  name: string;
  accentColor: string;
  items: CatalogItem[];
};

/** Katalog aktif + promo terbaik per menu. Tanpa cache: promo bergantung waktu. */
export async function getCatalog(): Promise<CatalogBrand[]> {
  await connection(); // promo bergantung waktu: render per request
  const now = new Date();
  const [bs, items, ps] = await Promise.all([
    db.select().from(brands).where(eq(brands.isActive, true)).orderBy(asc(brands.sortOrder)),
    db.select().from(menuItems).where(eq(menuItems.isAvailable, true)).orderBy(asc(menuItems.category), asc(menuItems.name)),
    db.select().from(promos).where(and(eq(promos.isActive, true), lte(promos.startsAt, now), gte(promos.endsAt, now))),
  ]);

  return bs.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    accentColor: b.accentColor,
    items: items
      .filter((i) => i.brandId === b.id)
      .map((i) => {
        const cands = ps.filter((p) => p.brandId === b.id && (p.menuItemId === null || p.menuItemId === i.id));
        const best = bestPromo(i.normalPrice, cands);
        return {
          id: i.id,
          name: i.name,
          category: i.category,
          normalPrice: i.normalPrice,
          promo: best ? { title: best.promo.title, final: best.final } : null,
        };
      }),
  }));
}
