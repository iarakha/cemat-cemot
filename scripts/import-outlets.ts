// Lokal saja. Dry-run default; tambah --apply untuk menyimpan. Tidak memakai seed destruktif.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const slugs: Record<string, string> = {
  "Fore Coffee": "fore", "Kopi Kenangan": "kopi-kenangan", "Cotti Coffee": "cotti",
  "Janji Jiwa": "janji-jiwa", "Tomoro Coffee": "tomoro",
};
const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--apply" || !arg.startsWith("--")), "Argumen tidak dikenal");
const file = args.find((arg) => arg !== "--apply") ?? "docs/research/outlet-locations/fore-locations.json";
assert(args.filter((arg) => arg !== "--apply").length <= 1, "Pakai: import-outlets.ts [file.json] [--apply]");
const apply = args.includes("--apply");
const rollback = new Error("dry-run rollback");

async function main() {
  const input: unknown = JSON.parse(await readFile(file, "utf8"));
  assert(Array.isArray(input) && input.length > 0, "Dataset kosong/tidak valid");
  const seen = new Set<string>();
  const rows = input.map((row: unknown, index: number) => {
    assert(row && typeof row === "object", `Baris ${index + 1} tidak valid`);
    const r = row as Record<string, unknown>;
    assert(typeof r.brand === "string" && Object.hasOwn(slugs, r.brand), "Brand tidak dikenal");
    assert(typeof r.name === "string" && r.name.trim(), "Nama outlet wajib");
    assert(typeof r.address === "string" && r.address.trim(), "Alamat outlet wajib");
    assert(typeof r.source_url === "string" && new URL(r.source_url).protocol === "https:", "Sumber HTTPS wajib");
    assert(typeof r.checked_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.checked_at), "Tanggal pemeriksaan wajib");
    assert(["active", "inactive", "coming_soon", "unknown"].includes(String(r.status)), "Status tidak dikenal");
    for (const key of ["lat", "lng"] as const) {
      assert((typeof r[key] === "string" && r[key].trim()) || typeof r[key] === "number", `${key} wajib`);
    }
    const lat = Number(r.lat), lng = Number(r.lng);
    assert(Number.isFinite(lat) && lat >= -11 && lat <= 6, "Latitude di luar Indonesia");
    assert(Number.isFinite(lng) && lng >= 95 && lng <= 141, "Longitude di luar Indonesia");
    const slug = slugs[r.brand], name = r.name.trim(), address = r.address.trim();
    const key = JSON.stringify([slug, name.toLowerCase(), lat, lng]);
    assert(!seen.has(key), "Duplikat outlet dalam dataset");
    seen.add(key);
    const hex = createHash("sha256").update(key).digest("hex").slice(0, 32);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return { id, slug, name, address, lat, lng, is_active: r.status === "active" };
  });

  const url = new URL(process.env.DATABASE_URL!);
  assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Hanya DB lokal; remote butuh persetujuan terpisah");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const counts = { input: rows.length, inserted: 0, existing: 0 };
  try {
    try {
      await sql.begin(async (tx) => {
        await tx`LOCK TABLE outlets IN SHARE ROW EXCLUSIVE MODE`;
        const brands = await tx`SELECT id, slug FROM brands`;
        for (const row of rows) {
          const brand = brands.find((b) => b.slug === row.slug);
          assert(brand, `Brand belum ada: ${row.slug}`);
          const existing = await tx`SELECT id, name, address, lat, lng FROM outlets WHERE brand_id = ${brand.id} AND (id = ${row.id} OR lower(name) = lower(${row.name}))`;
          if (existing.length) {
            assert(existing.length === 1 && existing[0].name === row.name && existing[0].address === row.address && existing[0].lat === row.lat && existing[0].lng === row.lng, `Konflik outlet; perlu review: ${row.slug}/${row.name}`);
            counts.existing++;
            continue; // Pertahankan flag aktif dan perubahan admin yang sudah ada.
          }
          await tx`INSERT INTO outlets (id, brand_id, name, address, lat, lng, source, is_active)
            VALUES (${row.id}, ${brand.id}, ${row.name}, ${row.address}, ${row.lat}, ${row.lng}, 'MANUAL', ${row.is_active})`;
          const [saved] = await tx`SELECT address, lat, lng, is_active FROM outlets WHERE id = ${row.id}`;
          assert(saved.address === row.address && saved.lat === row.lat && saved.lng === row.lng && saved.is_active === row.is_active, "Verifikasi simpan gagal");
          counts.inserted++;
        }
        if (!apply) throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    console.log(JSON.stringify({ mode: apply ? "committed" : "rolled_back", ...counts }));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : "Import gagal; transaksi dibatalkan. Periksa dataset/koneksi DB.");
  process.exitCode = 1;
});
