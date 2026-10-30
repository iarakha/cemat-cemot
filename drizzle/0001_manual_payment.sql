CREATE TYPE "public"."payment_method" AS ENUM('BANK', 'EWALLET', 'QRIS_STATIC');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'PROOF_SENT' BEFORE 'PAID';--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status",
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"admin_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "payment_method" NOT NULL,
	"provider" text NOT NULL,
	"account_no" text,
	"account_name" text NOT NULL,
	"qris_image_path" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_accounts_dest_chk" CHECK (("payment_accounts"."type" = 'QRIS_STATIC' AND "payment_accounts"."qris_image_path" IS NOT NULL) OR ("payment_accounts"."type" <> 'QRIS_STATIC' AND "payment_accounts"."account_no" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING'::text;--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PROOF_SENT', 'VERIFIED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."payment_status";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."payment_status" USING "status"::"public"."payment_status";--> statement-breakpoint
DROP INDEX "payments_external_id_uq";--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "osm_query" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "unique_code" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "queue_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "proof_image_path" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_provider" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_account_no" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refund_account_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" "payment_method";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payment_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "destination_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "expected_amount" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "paid_amount" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "proof_image_path" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "proof_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "verified_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "admin_wa" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "payment_window_min" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "checkout_cutoff_min" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "verify_eta_min" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "use_unique_code" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "max_cups" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "closed_message" text;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_account_id_payment_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_admin_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_total_idx" ON "orders" USING btree ("total");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_active_unique_code_uq" ON "orders" USING btree ("unique_code") WHERE "orders"."unique_code" > 0 AND "orders"."status" NOT IN ('PAID', 'PROCESSING', 'READY', 'DONE', 'REFUND_REQUESTED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_active_order_uq" ON "payments" USING btree ("order_id") WHERE "payments"."status" IN ('PENDING', 'PROOF_SENT');--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "pickup_code";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "refund_account";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "external_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "qr_string";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "raw_webhook";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "paid_at";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_code_unique" UNIQUE("order_code");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_qty_chk" CHECK ("order_items"."qty" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_chk" CHECK ("orders"."total" = "orders"."subtotal" + "orders"."service_fee" + "orders"."unique_code");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_unique_code_chk" CHECK ("orders"."unique_code" BETWEEN 0 AND 99);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_queue_format_chk" CHECK ("orders"."queue_number" IS NULL OR "orders"."queue_number" ~ '^[A-Z0-9-]{1,12}$');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ready_chk" CHECK ("orders"."status" NOT IN ('READY', 'DONE') OR ("orders"."queue_number" IS NOT NULL AND "orders"."proof_image_path" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_expected_chk" CHECK ("payments"."expected_amount" > 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_chk" CHECK ("payments"."paid_amount" IS NULL OR "payments"."paid_amount" >= 0);--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_period_chk" CHECK ("promos"."ends_at" > "promos"."starts_at");--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_singleton_chk" CHECK ("store_settings"."id" = 1);