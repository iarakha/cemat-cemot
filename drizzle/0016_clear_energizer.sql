ALTER TABLE "orders" DROP CONSTRAINT "orders_processing_proof_chk";--> statement-breakpoint
DROP INDEX "orders_active_unique_code_uq";--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT'::text;--> statement-breakpoint
-- READY dihapus: dulu di antara PROCESSING dan DONE, riwayat dipetakan ke PROCESSING.
UPDATE "orders" SET "status" = 'PROCESSING' WHERE "status" = 'READY';--> statement-breakpoint
UPDATE "order_events" SET "from_status" = 'PROCESSING' WHERE "from_status" = 'READY';--> statement-breakpoint
UPDATE "order_events" SET "to_status" = 'PROCESSING' WHERE "to_status" = 'READY';--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING_PAYMENT', 'PROOF_SENT', 'VERIFYING', 'PAID', 'PROCESSING', 'DONE', 'REFUND_REQUESTED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "from_status" SET DATA TYPE "public"."order_status" USING "from_status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "order_events" ALTER COLUMN "to_status" SET DATA TYPE "public"."order_status" USING "to_status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT'::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
CREATE UNIQUE INDEX "orders_active_unique_code_uq" ON "orders" USING btree ("unique_code") WHERE "orders"."unique_code" > 0 AND "orders"."status" NOT IN ('PAID', 'PROCESSING', 'DONE', 'REFUND_REQUESTED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_processing_proof_chk" CHECK ("orders"."status" NOT IN ('PROCESSING', 'DONE') OR (nullif(btrim("orders"."queue_number"), '') IS NOT NULL AND nullif(btrim("orders"."order_proof_path"), '') IS NOT NULL));