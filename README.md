This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database lokal

- `npm run db:migrate`: migrasi versi Drizzle; jangan pakai `drizzle-kit push`.
- `npm run admin:create -- marco <email-asli>`: buat admin dengan username login unik (huruf kecil, 3–32 karakter) dan email wajib untuk info akun. Password minimal 8 karakter diminta dua kali tanpa ditampilkan; jangan taruh password di argumen atau chat. Username/email yang sudah ada ditolak, bukan di-reset. UI/API login admin belum dibuat.
- `npm run db:seed`: contoh katalog hanya untuk brand yang belum ada, tanpa menghapus/mengubah outlet, order, atau katalog lama. Hanya lokal non-production. Brand lama yang katalognya kosong tetap dikelola manual.
- `npx tsx --env-file=.env.local scripts/check-seed.ts`: jalankan seed dua kali pada katalog lokal terisi dan bandingkan hash seluruh tabel publik; tidak boleh ada perubahan.
- `npm run db:check`: cek konfigurasi dasar dan constraint lewat fixture rollback.
- Opsi menu memakai master (`option_groups`/`option_choices`) yang ditautkan ke menu lewat `menu_item_choices` beserta selisih harga per menu. Harga promo ada di `promo_prices` (berdiri sendiri, tanpa relasi ke tabel promo lain); badge Hemat dihitung dari `normal_price` dan `promo_price`. Server membaca opsi lewat `getMenuOptions()` dan memvalidasi pilihan pembeli lewat `resolveOptions()` (grup wajib, `max_select`, pilihan milik menu).
- `npm run db:check -- --ready`: tambahan pemeriksaan minimum admin, partner aktif, dan metadata merchant DEV. Bukan bukti harga menu asli, QR dapat dipindai, atau aplikasi siap produksi.

Migrasi `0005_neat_daredevil.sql` dipertahankan persis sesuai hash yang sudah diterapkan. Koreksi nilai konfigurasi `use_unique_code=false` dipindahkan ke `0006_disable_unique_code.sql`; order dan nominal historis tidak berubah.

Sebelum migrasi/perubahan data, buat backup PostgreSQL format custom di luar repo dengan permission terbatas dan verifikasi arsip memakai `pg_restore`. Backup DB tidak mencakup berkas `UPLOAD_DIR`; cadangkan berkas unggahan terpisah sebelum deployment.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
