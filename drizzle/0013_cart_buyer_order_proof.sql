CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"qty" integer NOT NULL,
	"choice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	CONSTRAINT "cart_items_qty_chk" CHECK ("cart_items"."qty" BETWEEN 1 AND 10),
	CONSTRAINT "cart_items_note_chk" CHECK ("cart_items"."note" IS NULL OR char_length("cart_items"."note") <= 100)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_hash" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_buyer_hash_unique" UNIQUE("buyer_hash")
);
--> statement-breakpoint
ALTER TABLE "orders" RENAME COLUMN "proof_image_path" TO "order_proof_path";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_ready_chk";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_proof_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_proof_by" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "buyer_hash" text;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_proof_by_admin_users_id_fk" FOREIGN KEY ("order_proof_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_hash","created_at","id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ready_chk" CHECK ("orders"."status" NOT IN ('READY', 'DONE') OR ("orders"."queue_number" IS NOT NULL AND "orders"."order_proof_path" IS NOT NULL));