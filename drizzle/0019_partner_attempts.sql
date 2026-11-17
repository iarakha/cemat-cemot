CREATE TABLE "fulfillment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"partner_company_id" uuid NOT NULL,
	"partner_name" text NOT NULL,
	"partner_amount" integer,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"outcome" text,
	"reason" text,
	"queue_number" text,
	"order_proof_path" text,
	"order_proof_at" timestamp with time zone,
	"order_proof_by" uuid,
	CONSTRAINT "fulfillment_attempts_sequence_uq" UNIQUE("order_id","sequence"),
	CONSTRAINT "fulfillment_attempts_sequence_chk" CHECK ("fulfillment_attempts"."sequence" > 0),
	CONSTRAINT "fulfillment_attempts_amount_chk" CHECK ("fulfillment_attempts"."partner_amount" IS NULL OR "fulfillment_attempts"."partner_amount" >= 0),
	CONSTRAINT "fulfillment_attempts_closed_chk" CHECK (("fulfillment_attempts"."closed_at" IS NULL AND "fulfillment_attempts"."outcome" IS NULL AND "fulfillment_attempts"."reason" IS NULL) OR ("fulfillment_attempts"."closed_at" IS NOT NULL AND "fulfillment_attempts"."outcome" IS NOT NULL AND "fulfillment_attempts"."outcome" IN ('FAILED', 'PAYMENT_CORRECTED') AND "fulfillment_attempts"."reason" IS NOT NULL AND char_length(btrim("fulfillment_attempts"."reason")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_partner_company_id_partner_companies_id_fk" FOREIGN KEY ("partner_company_id") REFERENCES "public"."partner_companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_assigned_by_admin_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_closed_by_admin_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_attempts" ADD CONSTRAINT "fulfillment_attempts_order_proof_by_admin_users_id_fk" FOREIGN KEY ("order_proof_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_attempts_current_uq" ON "fulfillment_attempts" USING btree ("order_id") WHERE "fulfillment_attempts"."closed_at" IS NULL;
--> statement-breakpoint
-- Keep existing payment/queue/proof data unchanged. No invented partner for unpaid orders.
INSERT INTO fulfillment_attempts (order_id, sequence, partner_company_id, partner_name, partner_amount, assigned_at, assigned_by)
SELECT DISTINCT ON (p.order_id) p.order_id, 1, p.partner_company_id, c.name, p.partner_amount,
  coalesce(p.verified_at, o.paid_at, p.created_at), p.verified_by
FROM payments p
JOIN orders o ON o.id = p.order_id
JOIN partner_companies c ON c.id = p.partner_company_id
WHERE p.status = 'VERIFIED'
ORDER BY p.order_id, p.verified_at DESC NULLS LAST, p.created_at DESC, p.id DESC;