// Seed dev. HARGA & MENU = CONTOH (bukan harga resmi brand); ganti lewat admin.
// ponytail: hapus-lalu-isi ulang, hanya untuk dev. Jangan jalankan di prod yang sudah berisi order.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
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

const DAY = 864e5;
const now = Date.now();

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

// [slug brand, nama menu | null = satu brand, judul, tipe, nilai, hari berlaku]
const PROMOS: [string, string | null, string, "PERCENT" | "AMOUNT_OFF" | "FIXED_PRICE", number, number][] = [
  ["fore", "Aren Latte", "Diskon 20%", "PERCENT", 20, 7],
  ["kopi-kenangan", null, "Potongan Rp5.000 semua menu", "AMOUNT_OFF", 5000, 3],
  ["cotti", "Coconut Latte", "Harga spesial", "FIXED_PRICE", 9900, 5],
  ["janji-jiwa", "Es Kopi Jiwa", "Diskon 15%", "PERCENT", 15, 7],
  ["tomoro", "Americano", "Harga spesial", "FIXED_PRICE", 9900, 2],
];

const OPTIONS = [
  { name: "Ukuran", required: true, choices: [["Regular", 0, true], ["Large", 4000, false]] },
  { name: "Gula", required: true, choices: [["Normal", 0, true], ["Less", 0, false], ["No Sugar", 0, false]] },
  { name: "Es", required: true, choices: [["Normal", 0, true], ["Less", 0, false], ["Panas", 0, false]] },
] as const;

async function main() {
 await db.transaction(async (tx) => {
  await tx.delete(s.orders); // cascade: payments, order_events
  await tx.delete(s.brands); // cascade: menu, opsi, promo, outlet
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

  const brandRows = await tx.insert(s.brands)
    .values(BRANDS.map((b, i) => ({ ...b, sortOrder: i }))).returning();
  const bySlug = new Map(brandRows.map((b) => [b.slug, b.id]));
  const menuIds = new Map<string, string>(); // `${slug}:${nama}` -> id

  for (const [slug, items] of Object.entries(MENU)) {
    const rows = await tx.insert(s.menuItems).values(
      items.map(([name, category, normalPrice]) => ({ brandId: bySlug.get(slug)!, name, category, normalPrice })),
    ).returning();
    for (const r of rows) {
      menuIds.set(`${slug}:${r.name}`, r.id);
      for (const [i, g] of OPTIONS.entries()) {
        const [grp] = await tx.insert(s.optionGroups)
          .values({ menuItemId: r.id, name: g.name, required: g.required, sortOrder: i }).returning();
        await tx.insert(s.optionChoices).values(
          g.choices.map(([label, priceDelta, isDefault]) => ({ groupId: grp.id, label, priceDelta, isDefault })),
        );
      }
    }
  }

  await tx.insert(s.promos).values(PROMOS.map(([slug, menu, title, type, value, days]) => ({
    brandId: bySlug.get(slug)!,
    menuItemId: menu ? menuIds.get(`${slug}:${menu}`)! : null,
    title, type, value,
    terms: "Contoh promo untuk pengembangan.",
    startsAt: new Date(now - DAY), endsAt: new Date(now + days * DAY),
  })));
 });
 console.log("seed ok");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
