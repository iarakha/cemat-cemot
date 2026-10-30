CREATE TYPE "public"."store_status" AS ENUM('OPEN', 'CLOSED', 'BREAK', 'PRAYER', 'LEAVE');--> statement-breakpoint
CREATE TABLE "partner_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"website" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_companies_phone_chk" CHECK ("partner_companies"."phone" ~ '^62[0-9]{8,13}$'),
	CONSTRAINT "partner_companies_website_chk" CHECK ("partner_companies"."website" IS NULL OR "partner_companies"."website" ~* '^https?://')
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "partner_company_id" uuid;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "status" "store_status" DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_company_id_partner_companies_id_fk" FOREIGN KEY ("partner_company_id") REFERENCES "public"."partner_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_partner_idx" ON "payments" USING btree ("partner_company_id");--> statement-breakpoint
UPDATE "store_settings" SET "status" = CASE WHEN "is_open" THEN 'OPEN'::"store_status" ELSE 'CLOSED'::"store_status" END;--> statement-breakpoint
ALTER TABLE "store_settings" DROP COLUMN "is_open";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_partner_chk" CHECK ("payments"."status" <> 'VERIFIED' OR "payments"."partner_company_id" IS NOT NULL);