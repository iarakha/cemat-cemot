CREATE UNIQUE INDEX "option_choices_one_default_uq" ON "option_choices" USING btree ("group_id") WHERE "option_choices"."is_default";--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_price_chk" CHECK ("menu_items"."normal_price" >= 0);--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_chk" CHECK ("order_events"."actor" IN ('buyer', 'admin', 'system'));--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_chk" CHECK ("order_items"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_note_chk" CHECK ("order_items"."note" IS NULL OR char_length("order_items"."note") <= 100);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_chk" CHECK ("orders"."subtotal" >= 0 AND "orders"."service_fee" >= 0);--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_coord_chk" CHECK ("outlets"."lat" BETWEEN -90 AND 90 AND "outlets"."lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_value_chk" CHECK ("promos"."value" > 0 AND ("promos"."type" <> 'PERCENT' OR "promos"."value" <= 100));--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_wa_chk" CHECK ("store_settings"."admin_wa" IS NULL OR "store_settings"."admin_wa" ~ '^62[0-9]{8,13}$');--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_limits_chk" CHECK ("store_settings"."payment_window_min" > 0 AND "store_settings"."checkout_cutoff_min" >= 0 AND "store_settings"."verify_eta_min" > 0 AND "store_settings"."max_cups" > 0 AND "store_settings"."service_fee" >= 0);