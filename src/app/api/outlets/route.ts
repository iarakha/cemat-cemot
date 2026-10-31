import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, outlets } from "@/db/schema";
import { bad, handle, json } from "@/server/http";

const num = (v: string | null, min: number, max: number, name: string) => {
  const n = Number(v);
  if (v === null || v.trim() === "" || !Number.isFinite(n) || n < min || n > max) throw bad(name, `angka ${min}..${max}`);
  return n;
};

// API-01. BR-20: tampil jika aktif dan (MANUAL atau synced_at <= 15 hari). BR-21: haversine, urut jarak, maks 10.
export const GET = handle(async (req) => {
  const sp = new URL(req.url).searchParams;
  const slug = sp.get("brand");
  if (!slug) throw bad("brand", "wajib");
  const [brand] = await db.select({ id: brands.id }).from(brands).where(and(eq(brands.slug, slug), eq(brands.isActive, true)));
  if (!brand) return json([]);
  const visible = and(eq(outlets.brandId, brand.id), eq(outlets.isActive, true),
    or(eq(outlets.source, "MANUAL"), sql`${outlets.syncedAt} > now() - interval '15 days'`));
  const cols = { id: outlets.id, name: outlets.name, address: outlets.address, city: outlets.city };

  if (sp.has("lat") || sp.has("lng")) {
    const lat = num(sp.get("lat"), -90, 90, "lat"), lng = num(sp.get("lng"), -180, 180, "lng");
    const d = sql<number>`2 * 6371 * asin(least(1, sqrt(power(sin(radians(${outlets.lat} - ${lat}) / 2), 2) + cos(radians(${lat})) * cos(radians(${outlets.lat})) * power(sin(radians(${outlets.lng} - ${lng}) / 2), 2))))`;
    const rows = await db.select({ ...cols, distanceKm: d }).from(outlets).where(visible).orderBy(asc(d), asc(outlets.id)).limit(10);
    return json(rows.map((r) => ({ ...r, distanceKm: Math.round(r.distanceKm * 10) / 10 })));
  }
  const q = sp.get("q")?.trim();
  if (!q || q.length > 80) throw bad("q", "lat&lng atau q (1–80 karakter) wajib");
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db.select(cols).from(outlets)
    .where(and(visible, or(ilike(outlets.city, like), ilike(outlets.name, like), ilike(outlets.address, like))))
    .orderBy(asc(outlets.name), asc(outlets.id)).limit(10);
  return json(rows);
});
