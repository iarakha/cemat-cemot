# Backend HTTP — Cemat Cemot

Base URL lokal saat ini: `http://localhost:3210` (gunakan URL/port dari `next dev`). Semua respons JSON `Cache-Control: no-store`. Error: `{ "error": { "code": "...", "message": "..." } }`. API cookie-auth same-origin; tidak ada CORS wildcard. Frontend memakai `fetch(path, { credentials: "same-origin" })`.

Status: implementasi BE awal, bukan deklarasi seluruh cakupan RND selesai. OTP fail-closed karena provider belum dipilih. Import CSV/XLSX dan avatar belum tersedia. Admin REST adalah adapter tambahan untuk service DB; kontrak RND sebelumnya menyebut Server Actions. UI admin belum dibangun.

## Publik

| Method | Path | Input / hasil |
| --- | --- | --- |
| GET | `/api/health` | Cek koneksi DB, `{ok:true}` |
| GET | `/api/store` | Status, label, jam, fee, batas cup/bayar, adminWa |
| GET | `/api/catalog` | `{brands:[{id,slug,name,items:[{id,name,normalPrice,promo,options}]}]}`. Opsi berisi grup, required, maxSelect, choices, delta, default |
| GET | `/api/outlets?brand=fore&lat=-6.2&lng=106.8` | Maks 10 aktif terdekat, haversine, distanceKm |
| GET | `/api/outlets?brand=fore&q=Jakarta` | Cari nama/alamat/city; maks 10 |
| POST | `/api/checkout` | Isi keranjang localStorage dikirim lewat body (brandSlug, outletId, items). Harga dan opsi divalidasi ulang di server. 201 `{token}`, replay 200. Header `Idempotency-Key` juga diterima jika field body kosong |
| GET | `/api/pesanan/{token}` | Status, item snapshot, totals, expiresAt, queueNumber, payment, paymentAccounts, phases (jam dari events), progress (5 langkah customer: label, checked, active, at), refundState, adminWa, waUrls |
| POST | `/api/pesanan/{token}/proof` | Multipart field `file`, JPEG/PNG/WebP <=10 MB. 204; VERIFYING terkunci 409, expired 410 |
| POST | `/api/pesanan/{token}/refund-account` | `{method:"BANK"|"EWALLET",provider,accountNo,accountName}`; hanya REFUND_REQUESTED; 204 |
| GET | `/api/pesanan/{token}/files/payment-proof` | Gambar bukti bayar milik token |
| GET | `/api/pesanan/{token}/files/order-proof` | Bukti order dari admin milik token |
| GET | `/api/qris/{paymentAccountId}` | QRIS tujuan aktif |
| POST | `/api/pesanan/lookup` | `{type:"phone"|"booking"|"pickup",value,brand?,outletId?}`. Tanpa cookie perangkat dan tanpa sesi OTP: 202 generik, tidak membuka order. Dengan keduanya/salah satu: hanya order milik perangkat/HP ber-OTP |
| GET | `/api/customer/orders?limit=10&offset=0` | Riwayat: order dari perangkat ini (cookie `cc_buyer`) ATAU nomor HP ber-OTP. Respons `{orders:[...],limit,offset}`, item `{token,orderCode,status,total,queueNumber,brand,outlet,createdAt}`; `token` untuk `/api/pesanan/{token}`. Tanpa identitas: 200 daftar kosong. Urut terbaru |
| POST | `/api/customer/otp/request` | `{challenge}`. Saat ini 503 OTP_UNAVAILABLE; tidak membuat sesi/challenge tersimpan |
| POST | `/api/customer/otp/verify` | `{challengeId,otp}`. Saat ini 503 OTP_UNAVAILABLE; tidak auto-login |

Keranjang disimpan di localStorage; tidak ada API cart atau tabel keranjang. Kosongkan localStorage setelah checkout sukses.

Checkout JSON:

```json
{
  "idempotencyKey": "<UUID acak per checkout>",
  "brandSlug": "fore",
  "outletId": "<UUID dari API outlets>",
  "customer": { "name": "Nama pembeli", "phone": "081234567890" },
  "items": [{ "menuItemId": "<UUID dari catalog>", "qty": 1, "choiceIds": ["<UUID pilihan wajib>"], "note": "" }],
  "expectedTotal": 34000
}
```

Nilai total contoh bukan harga resmi. Hitung dari katalog; server tetap menghitung ulang. 409 PRICE_CHANGED memuat `error.expectedTotal` untuk persetujuan ulang. Pilih semua grup wajib; tidak ada default diam-diam. Checkout membuat cookie perangkat `cc_buyer` (produksi `__Host-cc_buyer`, httpOnly, SameSite=Lax, 180 hari; DB menyimpan SHA-256) untuk riwayat perangkat, bukan sesi OTP atau bukti kepemilikan nomor HP.

## Admin

| Method | Path | Input / hasil |
| --- | --- | --- |
| POST | `/api/admin/session` | `{username,password}`; sukses cookie httpOnly 12 jam |
| GET | `/api/admin/session` | Identitas sesi; 401 bila tidak valid |
| DELETE | `/api/admin/session` | Logout; 204 |
| GET | `/api/admin/orders?status=PAID&q=&limit=20&offset=0` | Daftar order. Respons `{orders,total,counts,limit,offset}`: `total` mengikuti `status`+`q`; `counts` per status (+`ALL`) mengikuti `q` saja, untuk chip filter. Tiap baris: `id,orderCode,status,customerName,customerPhone(62..),queueNumber,brand,outlet,total,hasOrderProof,orderProofAt,createdAt,paidAt`. `q` cari kode booking, nomor antrean, nama, potongan HP (08/62). PAID/PROCESSING urut paidAt naik |
| GET | `/api/admin/orders/{orderId}` | Order (termasuk `customerName`,`customerPhone`,`queueNumber`, `orderProof:{exists,uploadedAt,uploadedBy}`), item, riwayat payment (`hasProof` = bukti bayar pembeli), event. Tidak mengubah status |
| GET | `/api/admin/dashboard?range=today\|7d\|month` | Ringkasan hari Jakarta: `revenue,paidCount` (PAID/PROCESSING/DONE menurut `paidAt`), `unpaid{total,awaitingProof,needsCheck}`, `processing{total,orderedToPartner,inProgress}`, `done`, `byStatus` (menurut `createdAt`) |
| POST | `/api/admin/orders/{orderId}/{action}` | JSON kecuali aksi upload. Aksi di bawah |
| GET | `/api/admin/files/payment-proof/{paymentId}` | Bukti pembayaran pembeli (ID payment, bukan order) |
| GET | `/api/admin/files/order-proof/{orderId}` | Bukti order di app brand (diunggah admin) |
| GET | `/api/admin/files/qris/{paymentAccountId}` | QRIS admin, termasuk nonaktif |
| PATCH | `/api/admin/profile` | `{action:"identity",username,email,currentPassword}` atau `{action:"password",currentPassword,newPassword,confirmation}`. Sukses mencabut seluruh sesi |

Aksi order:

| action | Body |
| --- | --- |
| `payment-proof` | Multipart `file`: admin membantu unggah BUKTI BAYAR pembeli sebelum mulai verifikasi (tabel payments). Bukan bukti order |
| `start-verification` | `{}`; PROOF_SENT ke VERIFYING |
| `confirm-payment` | `{paidAmount,partnerCompanyId,partnerAmount,note?}`; hanya VERIFYING. Partner aktif wajib, nominal diterima >= total |
| `reject-payment` | `{reason,note?}`; payment lama REJECTED, payment baru PENDING, deadline baru |
| `revert-confirmation` | `{note}`; hanya PAID sebelum processing |
| `reopen` | `{to:"PAID"|"REFUND_REQUESTED",paidAmount,note,partnerCompanyId?,partnerAmount?}`; hanya CANCELLED; PAID wajib partner |
| `cancel` | `{note}`; hanya PENDING_PAYMENT/PROOF_SENT/VERIFYING |
| `start-processing` | Multipart `queueNumber`, `file` (bukti order di app partner), `note?`; PAID ke PROCESSING; nomor antrean + foto wajib dan disimpan atomik |
| `order-proof` | Multipart `queueNumber?`, `file?`, `note?`; minimal salah satu; PROCESSING/DONE. Simpan ke kolom bukti order (`orders.order_proof_path/at/by`), tidak menyentuh bukti bayar. `replace-proof` = alias lama |
| `mark-done` | `{}`; PROCESSING ke DONE |
| `fail` | `{reason,note?}`; PAID/PROCESSING ke REFUND_REQUESTED |
| `mark-refunded` | `{note}`; rekening refund wajib terisi |

Semua aksi ber-guard, transaksi dan row lock. Replay transisi yang sudah selesai mengembalikan `{alreadyProcessed:true,status}`. WA hanya tautan manual, tidak ada pengiriman otomatis.

Flow utama: PENDING_PAYMENT → PROOF_SENT → VERIFYING → PAID → PROCESSING → DONE. Customer melihat 5 label: Menunggu pembayaran, Bukti dikirim, Verifikasi pembayaran, Diproses (PAID/PROCESSING), Selesai. Bukti dikirim tercentang sejak PROOF_SENT, verifikasi sejak PAID, Diproses sejak PROCESSING, Selesai saat DONE. Waktu verifikasi selesai berasal dari event PAID. `mark-ready` dihapus (404).

Migrasi `0015_ui_order_flow`: READY lama menjadi PROCESSING; PROCESSING lama tanpa nomor/foto kembali PAID dengan event audit. Enum READY hanya dipertahankan untuk riwayat lama; constraint melarang order aktif berstatus READY. REFUND_REQUESTED/REFUNDED/CANCELLED tetap tersedia sebagai jalur pengecualian; S07 hanya desain arsip, bukan penghapusan data refund. Jangan jalankan migrasi ke DB operasional tanpa backup dan persetujuan.

## Master data admin

`GET /api/admin/data/{entity}?limit=50&offset=0&brandId=...` Respons `{items,total,limit,offset}`; `menu` dan `outlets` juga `byBrand:{brandId:jumlah}` (tanpa filter brand, untuk chip). Pengecualian: `settings` mengembalikan objek pengaturan + `schedule`.
`POST /api/admin/data/{entity}` membuat data.
`PUT /api/admin/data/{entity}/{id}` menyimpan data lengkap (bukan partial patch).
`DELETE /api/admin/data/{entity}/{id}` body `{confirm:true}`.

| entity | Field simpan |
| --- | --- |
| `brands` | Baca saja |
| `menu` | brandId,name,category,normalPrice,promoPrice(nullable),description?,isAvailable?,sortOrder?,choices:[{choiceId,priceDelta,isDefault}]. Menu + promo + tautan opsi atomik |
| `option-groups` | name,required,maxSelect,sortOrder? |
| `option-choices` | groupId,label,sortOrder? |
| `outlets` | brandId,name,address,city(nullable),lat,lng,isActive?. MANUAL untuk data baru; DELETE selalu ditolak untuk menjaga data outlet |
| `partners` | name,phone(nullable),website(nullable),notes(nullable, maks 500),isActive? |
| `payment-accounts` | Multipart: type,provider,accountName,accountNo?,isActive,sortOrder?,file(gambar QRIS). BANK/EWALLET selalu cadangan nonaktif. QRIS terakhir terlindungi |
| `settings` | POST update singleton: status,openAt,closeAt,adminWa,serviceFee,maxCups,paymentWindowMin,checkoutCutoffMin,verifyEtaMin,closedMessage?,autoSchedule?,schedule?:[{day:0-6 (0=Minggu),isClosed?,openAt,closeAt}]. `schedule` dikirim = mengganti seluruh jadwal; hari tanpa entri memakai openAt/closeAt default. Bila `autoSchedule` true: hari libur = tutup, jam hari itu dipakai, dan status manual non-OPEN berlaku sampai pergantian hari Jakarta |

Entitas terpakai FK tidak bisa dihapus; nonaktifkan. Master opsi tertaut harus dilepas dari menu sebelum hapus. Tujuan payment yang pernah dipakai tidak ditimpa; buat pengganti untuk menjaga riwayat.

## Cron / konfigurasi

`POST /api/cron/expire-orders`: `Authorization: Bearer <CRON_SECRET>`, hasil `{expired}`. Hanya PENDING_PAYMENT yang expired; PROOF_SENT/VERIFYING tidak disentuh.

`POST /api/cron/osm-sync`: auth sama. Hanya brand dengan `osmQuery` terisi; query kosong berarti no-op aman. Upsert OSM, tidak menghapus outlet, tidak menimpa MANUAL atau flag aktif admin. Semua brand lokal sekarang tanpa query OSM.

Env server-only: DATABASE_URL, UPLOAD_DIR, OTP_HMAC_SECRET (>=32 karakter acak), CRON_SECRET (>=32), APP_URL. Jangan kirim secret ke frontend/commit. Reverse proxy produksi wajib menimpa x-forwarded-for, membatasi body upload dan request JSON; konfigurasi deployment belum termasuk pekerjaan ini.

## Verifikasi

`npm run check`: pricing, order rules, decode upload.
`API_BASE_URL=http://localhost:3210 npm run api:check`: HTTP read-only; tidak membuat order.
`npm run build && npm run api:test`: buat DB PostgreSQL lokal sementara, migrate/seed, uji HTTP checkout paralel sampai DONE, hapus hanya DB/berkas test milik runner. Membutuhkan role lokal dengan CREATE DATABASE. Tidak menjalankan fixture pada DB operasional. Port test 3211 harus kosong.

Belum selesai: provider OTP nyata + recovery end-to-end, bulk import CSV/XLSX, avatar, pemantauan/rate limit reverse proxy dan deployment. Endpoint sudah tersedia tidak berarti seluruh cabang kontrak sudah diuji; lihat hasil test dan review sebelum produksi.
