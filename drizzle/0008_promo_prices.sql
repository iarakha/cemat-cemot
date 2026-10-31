CREATE TABLE "promo_prices" (
	"menu_item_id" uuid PRIMARY KEY NOT NULL,
	"promo_price" integer NOT NULL,
	CONSTRAINT "promo_prices_price_chk" CHECK ("promo_prices"."promo_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "promo_prices" ADD CONSTRAINT "promo_prices_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;