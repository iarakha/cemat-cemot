ALTER TABLE "payments" DROP CONSTRAINT "payments_verified_partner_chk";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "partner_amount" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_amount_chk" CHECK ("payments"."partner_amount" IS NULL OR "payments"."partner_amount" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_partner_chk" CHECK ("payments"."status" <> 'VERIFIED' OR ("payments"."partner_company_id" IS NOT NULL AND "payments"."partner_amount" IS NOT NULL));