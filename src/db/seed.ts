// Seed dev. HARGA & MENU = CONTOH (bukan harga resmi brand); ganti lewat admin.
// ponytail: contoh katalog hanya untuk brand baru; katalog brand lama dikelola lewat admin.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

// admin_wa dan QRIS = konfigurasi di DB (store_settings, payment_accounts). Seed hanya mengisi nilai DEV
// jika belum ada dan TIDAK menimpa yang sudah diubah. Ganti lewat admin atau UPDATE langsung.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve(".uploads"); // hanya tempat file QRIS DEV

// PNG kotak-kotak 210x210 (grayscale) sebagai pengganti gambar QRIS. BUKAN QR asli, tidak bisa dipindai.
function devQrisPng(): Buffer {
  const n = 210, cell = 10, raw = Buffer.alloc((n + 1) * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    raw[y * (n + 1) + 1 + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 40;
  const chunk = (t: string, d: Buffer) => {
    const b = Buffer.concat([Buffer.from(t), d]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(d.length); crc.writeUInt32BE(crc32(b));
    return Buffer.concat([len, b, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; // 8-bit, grayscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const BRANDS = [
  { slug: "fore", name: "Fore Coffee", accentColor: "#2f7d5b" },
  { slug: "kopi-kenangan", name: "Kopi Kenangan", accentColor: "#c0392b" },
  { slug: "cotti", name: "Cotti Coffee", accentColor: "#e0a100" },
  { slug: "janji-jiwa", name: "Janji Jiwa", accentColor: "#d9578a" },
  { slug: "tomoro", name: "Tomoro Coffee", accentColor: "#3b6fb6" },
] as const;

// [nama, kategori, harga]
const MENU: Record<string, [string, string, number][]> = {
  fore: [
    ["Aren Latte", "Kopi Susu", 29000], ["Butterscotch Latte", "Kopi Susu", 31000],
    ["Americano", "Kopi", 24000], ["Cappuccino", "Kopi", 30000], ["Matcha Latte", "Non-Kopi", 32000],
  ],
  "kopi-kenangan": [
    ["Kopi Kenangan Mantan", "Kopi Susu", 24000], ["Kenangan Latte", "Kopi Susu", 28000],
    ["Americano", "Kopi", 22000], ["Choco Hazelnut", "Non-Kopi", 29000], ["Matcha Latte", "Non-Kopi", 29000],
  ],
  cotti: [
    ["Coconut Latte", "Kopi Susu", 22000], ["Cotti Latte", "Kopi Susu", 20000],
    ["Americano", "Kopi", 16000], ["Cappuccino", "Kopi", 21000], ["Lemon Tea", "Non-Kopi", 17000],
  ],
  "janji-jiwa": [
    ["Kopi Susu Janji Jiwa", "Kopi Susu", 18000], ["Es Kopi Jiwa", "Kopi Susu", 20000],
    ["Americano", "Kopi", 17000], ["Thai Tea", "Non-Kopi", 19000], ["Choco Jiwa", "Non-Kopi", 21000],
  ],
  tomoro: [
    ["Tomoro Latte", "Kopi Susu", 23000], ["Coconut Latte", "Kopi Susu", 25000],
    ["Americano", "Kopi", 18000], ["Cappuccino", "Kopi", 24000], ["Matcha Latte", "Non-Kopi", 26000],
  ],
};

// Master pilihan (sekali, dipakai semua menu): [grup, wajib, [label...]]. Harga/default per menu ada di MENU_OPTIONS.
const MASTERS: [string, boolean, string[]][] = [
  ["Suhu", true, ["Es", "Panas"]],
  ["Ukuran", true, ["Regular", "Large"]],
  ["Gula", true, ["No Sugar", "Less", "Normal", "Extra"]],
  ["Level Es", true, ["Less", "Normal"]],
];
// Pilihan contoh per menu baru: [grup, label, selisih harga, default]. Large +4.000 hanya contoh.
const MENU_OPTIONS: [string, string, number, boolean][] = [
  ["Suhu", "Es", 0, true], ["Suhu", "Panas", 0, false],
  ["Ukuran", "Regular", 0, true], ["Ukuran", "Large", 4000, false],
  ["Gula", "Normal", 0, true], ["Gula", "Less", 0, false], ["Gula", "No Sugar", 0, false], ["Gula", "Extra", 0, false],
  ["Level Es", "Normal", 0, true], ["Level Es", "Less", 0, false],
];

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Seed contoh hanya boleh dijalankan di DB lokal non-production");
  }
 await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(112848, 1)`);
  await tx.insert(s.storeSettings).values({ id: 1, adminWa: "6281200000000" }).onConflictDoNothing();

  // Tambah akun BANK/EWALLET/QRIS lain nanti lewat baris payment_accounts, tanpa migrasi.
  if ((await tx.select({ id: s.paymentAccounts.id }).from(s.paymentAccounts).limit(1)).length === 0) {
    const qrisPath = "qris/dev-qris.png"; // relatif ke UPLOAD_DIR
    mkdirSync(path.join(UPLOAD_DIR, "qris"), { recursive: true });
    writeFileSync(path.join(UPLOAD_DIR, qrisPath), devQrisPng());
    await tx.insert(s.paymentAccounts).values({
      type: "QRIS_STATIC", provider: "DEV Cemat Cemot", accountName: "DEV Cemat Cemot (bukan QR asli)", qrisImagePath: qrisPath,
    });
  }

  // Master tidak pernah ditimpa: hanya ditambah jika belum ada, sehingga edit admin tetap utuh.
  await tx.insert(s.optionGroups)
    .values(MASTERS.map(([name, required], sortOrder) => ({ name, required, sortOrder })))
    .onConflictDoNothing({ target: s.optionGroups.name });
  const groups = await tx.select().from(s.optionGroups);
  await tx.insert(s.optionChoices)
    .values(MASTERS.flatMap(([g, , labels]) => labels.map((label, sortOrder) => ({ groupId: groups.find((x) => x.name === g)!.id, label, sortOrder }))))
    .onConflictDoNothing();
  const choice = new Map((await tx.select().from(s.optionChoices))
    .map((c) => [`${groups.find((g) => g.id === c.groupId)?.name}:${c.label}`, c]));

  const brandRows = await tx.insert(s.brands)
    .values(BRANDS.map((b, i) => ({ ...b, sortOrder: i })))
    .onConflictDoNothing({ target: s.brands.slug }).returning();
  const bySlug = new Map(brandRows.map((b) => [b.slug, b.id]));

  for (const [slug, items] of Object.entries(MENU)) {
    if (!bySlug.has(slug)) continue;
    const rows = await tx.insert(s.menuItems).values(
      items.map(([name, category, normalPrice]) => ({ brandId: bySlug.get(slug)!, name, category, normalPrice })),
    ).returning();
    const links = rows.flatMap((r) => MENU_OPTIONS.map(([g, label, priceDelta, isDefault]) => {
      const c = choice.get(`${g}:${label}`)!;
      return { menuItemId: r.id, choiceId: c.id, groupId: c.groupId, priceDelta, isDefault };
    }));
    await tx.insert(s.menuItemChoices).values(links);
  }
 });
 console.log("seed ok");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
