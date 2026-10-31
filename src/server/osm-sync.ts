import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, outlets } from "@/db/schema";
import { ApiError } from "./http";

/** OSM sync never deletes outlets or overwrites MANUAL/admin is_active. Network failure leaves old data intact. */
export async function syncOsm() {
  const configured = await db.select().from(brands).where(eq(brands.isActive, true));
  const pending: (typeof outlets.$inferInsert)[] = [];
  for (const b of configured) {
    // No query configured means no permission to infer a regex or import unknown matches.
    if (!b.osmQuery) continue;
    if (!/^[A-Za-z0-9 .|()-]{1,120}$/.test(b.osmQuery)) throw new ApiError(422, "INVALID_OSM_QUERY", "Pola OSM tidak valid");
    const query = `[out:json][timeout:25];area["ISO3166-1"="ID"][admin_level=2]->.id;nwr["amenity"="cafe"]["name"~"${b.osmQuery}",i](area.id);out center;`;
    let elements: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(35_000) });
        if (!r.ok) throw new Error("Overpass unavailable");
        const payload = await r.json();
        if (!Array.isArray(payload.elements) || payload.remark) throw new Error("Invalid Overpass response");
        elements = payload.elements;
        break;
      } catch {
        if (attempt === 2) throw new ApiError(503, "OSM_UNAVAILABLE", "Sinkron gagal; data lama tetap utuh");
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    for (const raw of elements as Record<string, unknown>[]) {
      const tags = raw.tags as Record<string, string> | undefined;
      const center = raw.center as { lat?: number; lon?: number } | undefined;
      const lat = raw.lat ?? center?.lat, lng = raw.lon ?? center?.lon;
      if (!tags?.name || tags.name.length > 200 || typeof lat !== "number" || typeof lng !== "number" || lat < -11.5 || lat > 6.5 || lng < 94.5 || lng > 141.5 || !Number.isSafeInteger(raw.id)) continue;
      if (!["node", "way", "relation"].includes(String(raw.type))) continue;
      pending.push({ brandId: b.id, name: tags.name, address: tags["addr:full"] ?? null, city: tags["addr:city"] ?? null, lat, lng, osmId: `${raw.type}/${raw.id}`, source: "OSM", syncedAt: new Date() });
    }
  }
  await db.transaction(async (tx) => {
    for (const p of pending) await tx.insert(outlets).values(p).onConflictDoUpdate({
      target: outlets.osmId,
      set: { name: p.name, address: p.address, city: p.city, lat: p.lat, lng: p.lng, syncedAt: p.syncedAt },
      setWhere: and(eq(outlets.source, "OSM"), eq(outlets.brandId, p.brandId)),
    });
  });
  // All current imported outlets are MANUAL. Empty osmQuery intentionally produces a safe no-op.
  const counts = await db.execute(sql`select count(*)::int as total from outlets`);
  return { received: pending.length, configuredBrands: configured.filter((b) => b.osmQuery).length, totalOutlets: counts[0].total };
}
