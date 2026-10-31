-- Master pilihan: grup/pilihan dimiliki global, harga & default per menu ada di menu_item_choices.
-- Data lama dipindah (bukan dibuang). Grup lama "Es" dipecah: "Panas" -> grup Suhu; Normal/Less -> grup Level Es.
-- Semua menu yang punya grup Es otomatis mendapat Suhu:Es (default) agar perilaku lama tetap sama.
CREATE TABLE "menu_item_choices" (
	"menu_item_id" uuid NOT NULL,
	"choice_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "menu_item_choices_menu_item_id_choice_id_pk" PRIMARY KEY("menu_item_id","choice_id")
);--> statement-breakpoint
CREATE TEMP TABLE "_opt_stage" AS
SELECT g.menu_item_id,
  CASE WHEN g.name = 'Es' AND c.label = 'Panas' THEN 'Suhu' WHEN g.name = 'Es' THEN 'Level Es' ELSE g.name END AS group_name,
  g.required, g.sort_order AS group_sort, c.label, c.price_delta, c.is_default
FROM "option_choices" c JOIN "option_groups" g ON g.id = c.group_id;--> statement-breakpoint
INSERT INTO "_opt_stage" (menu_item_id, group_name, required, group_sort, label, price_delta, is_default)
SELECT g.menu_item_id, 'Suhu', true, 0, 'Es', 0,
  NOT EXISTS (SELECT 1 FROM "option_choices" p WHERE p.group_id = g.id AND p.label = 'Panas' AND p.is_default)
FROM "option_groups" g WHERE g.name = 'Es';--> statement-breakpoint
DROP TABLE "option_choices";--> statement-breakpoint
DROP TABLE "option_groups";--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "option_groups_name_unique" UNIQUE("name"),
	CONSTRAINT "option_groups_max_select_chk" CHECK ("option_groups"."max_select" >= 1)
);--> statement-breakpoint
CREATE TABLE "option_choices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "option_choices_group_label_uq" UNIQUE("group_id","label"),
	CONSTRAINT "option_choices_id_group_uq" UNIQUE("id","group_id")
);--> statement-breakpoint
ALTER TABLE "option_choices" ADD CONSTRAINT "option_choices_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_choices" ADD CONSTRAINT "menu_item_choices_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_choices" ADD CONSTRAINT "menu_item_choices_choice_group_fk" FOREIGN KEY ("choice_id","group_id") REFERENCES "public"."option_choices"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_item_choices_one_default_uq" ON "menu_item_choices" USING btree ("menu_item_id","group_id") WHERE "menu_item_choices"."is_default";--> statement-breakpoint
CREATE INDEX "menu_item_choices_choice_idx" ON "menu_item_choices" USING btree ("choice_id");--> statement-breakpoint
INSERT INTO "option_groups" (name, required, sort_order)
SELECT group_name, bool_or(required),
  CASE group_name WHEN 'Suhu' THEN 0 WHEN 'Ukuran' THEN 1 WHEN 'Gula' THEN 2 WHEN 'Level Es' THEN 3 ELSE 10 + min(group_sort) END
FROM "_opt_stage" GROUP BY group_name;--> statement-breakpoint
-- Master siap pakai (tanpa tautan ke menu) agar admin bisa menambah langsung.
INSERT INTO "option_groups" (name, required, sort_order) VALUES ('Suhu', true, 0), ('Ukuran', true, 1), ('Gula', true, 2), ('Level Es', true, 3)
ON CONFLICT (name) DO NOTHING;--> statement-breakpoint
INSERT INTO "option_choices" (group_id, label, sort_order)
SELECT g.id, v.label, v.sort_order
FROM (VALUES ('Suhu','Es',0), ('Suhu','Panas',1), ('Ukuran','Regular',0), ('Ukuran','Large',1),
  ('Gula','No Sugar',0), ('Gula','Less',1), ('Gula','Normal',2), ('Gula','Extra',3),
  ('Level Es','Less',0), ('Level Es','Normal',1)) AS v(grp, label, sort_order)
JOIN "option_groups" g ON g.name = v.grp
ON CONFLICT (group_id, label) DO NOTHING;--> statement-breakpoint
INSERT INTO "option_choices" (group_id, label, sort_order)
SELECT DISTINCT g.id, s.label, 100
FROM "_opt_stage" s JOIN "option_groups" g ON g.name = s.group_name
ON CONFLICT (group_id, label) DO NOTHING;--> statement-breakpoint
INSERT INTO "menu_item_choices" (menu_item_id, choice_id, group_id, price_delta, is_default)
SELECT s.menu_item_id, c.id, c.group_id, s.price_delta, s.is_default
FROM "_opt_stage" s JOIN "option_groups" g ON g.name = s.group_name
JOIN "option_choices" c ON c.group_id = g.id AND c.label = s.label;--> statement-breakpoint
DO $$ BEGIN
  IF (SELECT count(*) FROM "menu_item_choices") <> (SELECT count(*) FROM "_opt_stage") THEN
    RAISE EXCEPTION 'option migration: link count mismatch';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "_opt_stage";
