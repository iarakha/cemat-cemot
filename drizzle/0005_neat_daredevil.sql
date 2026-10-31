ALTER TYPE "public"."order_status" ADD VALUE 'VERIFYING' BEFORE 'PAID';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'VERIFYING' BEFORE 'VERIFIED';--> statement-breakpoint
CREATE TABLE "customer_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_otp_attempts_chk" CHECK ("customer_otp_challenges"."attempts" BETWEEN 0 AND 5),
	CONSTRAINT "customer_otp_expiry_chk" CHECK ("customer_otp_challenges"."expires_at" > "customer_otp_challenges"."created_at")
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_phone" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "customer_sessions_phone_chk" CHECK ("customer_sessions"."customer_phone" ~ '^628[0-9]{8,11}$'),
	CONSTRAINT "customer_sessions_expiry_chk" CHECK ("customer_sessions"."expires_at" > "customer_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "order_code_counters" (
	"day" date PRIMARY KEY NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "order_code_counters_value_chk" CHECK ("order_code_counters"."last_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	CONSTRAINT "request_limits_count_chk" CHECK ("request_limits"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_queue_format_chk";--> statement-breakpoint
DROP INDEX "payments_active_order_uq";--> statement-breakpoint
ALTER TABLE "store_settings" ALTER COLUMN "use_unique_code" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "customer_otp_challenges" ADD CONSTRAINT "customer_otp_challenges_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_otp_order_idx" ON "customer_otp_challenges" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "customer_sessions_expires_idx" ON "customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "request_limits_reset_idx" ON "request_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "orders_history_idx" ON "orders" USING btree ("customer_phone","created_at","id");--> statement-breakpoint
CREATE INDEX "orders_queue_idx" ON "orders" USING btree ("queue_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_active_order_uq" ON "payments" USING btree ("order_id") WHERE "payments"."status" NOT IN ('VERIFIED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_phone_chk" CHECK ("orders"."customer_phone" ~ '^628[0-9]{8,11}$');--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_queue_format_chk" CHECK ("orders"."queue_number" IS NULL OR (char_length(btrim("orders"."queue_number")) BETWEEN 1 AND 64 AND "orders"."queue_number" !~ '[[:cntrl:]]'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_chk" CHECK ("payments"."status"::text NOT IN ('PROOF_SENT', 'VERIFYING') OR ("payments"."proof_image_path" IS NOT NULL AND "payments"."proof_claimed_at" IS NOT NULL));