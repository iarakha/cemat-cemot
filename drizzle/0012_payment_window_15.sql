ALTER TABLE "store_settings" ALTER COLUMN "payment_window_min" SET DEFAULT 15;
--> statement-breakpoint
UPDATE "store_settings" SET "payment_window_min" = 15 WHERE "id" = 1;