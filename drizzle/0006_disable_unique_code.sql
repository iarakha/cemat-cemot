-- Order QRIS baru tanpa kode unik nominal; nominal dan riwayat order lama tidak diubah.
UPDATE "store_settings" SET "use_unique_code" = false WHERE "id" = 1;
