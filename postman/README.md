# Postman — Cemat Cemot

Import kedua file lewat Postman > Import:

- `Cemat-Cemot.postman_collection.json`
- `Local.postman_environment.json`

Pilih environment `Cemat Cemot - Local (no secrets)`. `base_url` default `http://localhost:3210`; sesuaikan port server.

## Mulai baca data

Jalankan folder `01 - Read-only publik`: Health, Store, Catalog, lalu Outlets lokasi terdekat. Skrip menyimpan brand/menu/default pilihan/outlet serta total server ke environment. Request QRIS memerlukan `payment_account_id` dari tracking atau daftar rekening admin.

## Login dan alur order

1. Isi `admin_password` secara lokal. Username default `marco`. Jangan kirim password lewat chat atau simpan hasil export berisi credential ke Git.
2. Jalankan Login di folder 02. Cookie jar Postman menangani sesi otomatis. Jangan jalankan Logout sebelum selesai.
3. Jalankan List partners di folder 06 untuk menyimpan partner aktif. Isi `customer_phone` dengan nomor test milik sendiri, format 08/628 yang valid.
4. Gunakan DB test untuk mutasi. Set `allow_mutations` menjadi string `true` secara sadar. Default `false` memblokir request mutasi lewat pre-request script. Ini guard kenyamanan, bukan kontrol keamanan server.
5. Checkout folder 03, lalu Tracking. Store harus OPEN dan masih dalam jam checkout. Token tersimpan otomatis. `idempotency_key` dibuat sekali; kosongkan hanya saat ingin order BARU. Untuk retry/replay jangan ganti key.
6. Pilih file lokal pada field `file` sebelum Upload bukti bayar. JPEG/PNG/WebP maksimal 10 MB. Jangan set Content-Type multipart manual; Postman membuat boundary.
7. Folder 05: Daftar order (cari booking yang sama), Detail, Mulai verifikasi, Konfirmasi pembayaran, Isi nomor antrean dan mulai proses, Selesai. `order_id` dipilih berdasarkan booking, bukan order pertama sembarang. Daftar hanya 50 order pertama; jika booking tidak ditemukan isi ID yang benar secara manual.
8. Konfirmasi pembayaran hanya setelah cocok mutasi. `paidAmount` default total dan `partnerAmount` default subtotal hanyalah template; tinjau nominal sebenarnya sebelum Send. Mulai proses wajib file foto dan nomor antrean; PAID → PROCESSING → DONE tanpa READY.

Jangan jalankan seluruh collection memakai Runner. Reject, cancel, reopen, refund, koreksi dan DONE adalah cabang status berbeda; tidak dapat dieksekusi berurutan pada satu order. Mutasi akun mencabut semua sesi. Cron dapat mengubah order/data.

## CRUD master

Create menyimpan ID fixture ke `target_*`. Update/Delete hanya memakai variabel target itu, terpisah dari ID menu/outlet operasional. PUT memerlukan objek lengkap. Fixture default nonaktif bila tersedia. Delete outlet sengaja 409: outlet dilindungi, hanya dinonaktifkan. Menghapus master yang masih tertaut juga ditolak; lepas relasi dahulu. Menu test memakai choices kosong secara eksplisit, bukan meniru default menu produksi.

## Batas fitur

- OTP belum tersedia: request/verify mengembalikan 503. UUID dummy di environment hanya memenuhi format input verify, bukan challenge sah. Isi OTP apa pun yang tepat 6 digit hanya untuk menguji fail-closed; tidak akan login.
- History customer 401 tanpa sesi terverifikasi. Lookup tanpa sesi mengembalikan 202 generik, bukan akses order.
- Bulk import dan avatar belum ada endpoint.
- `cron_secret`, password dan token sengaja kosong. Isi hanya secara lokal. Jangan share/export environment atau cookie jar setelah berisi rahasia/data pembeli.
- Semua example body adalah template, bukan data order nyata. HTTP test menguji status kontrak, tidak membuktikan pembayaran benar atau seluruh business rule lolos.

## Validasi artefak

`node scripts/check-postman.mjs`: cek JSON, semua route/method implementasi terwakili, syntax skrip Postman, guard mutasi, dan variabel.

`node scripts/check-postman.mjs --live`: tambahan menjalankan lima request read-only beserta skrip Postman menggunakan Node VM, tanpa login/mutasi. Server harus hidup pada `base_url`. Bukan pengganti uji import di UI Postman.
