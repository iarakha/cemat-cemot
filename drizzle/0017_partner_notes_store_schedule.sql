CREATE TABLE "store_schedule" (
	"day" integer PRIMARY KEY NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"open_at" time,
	"close_at" time,
	CONSTRAINT "store_schedule_day_chk" CHECK ("store_schedule"."day" BETWEEN 0 AND 6),
	CONSTRAINT "store_schedule_hours_chk" CHECK ("store_schedule"."is_closed" OR ("store_schedule"."open_at" IS NOT NULL AND "store_schedule"."close_at" IS NOT NULL AND "store_schedule"."open_at" < "store_schedule"."close_at"))
);
--> statement-breakpoint
ALTER TABLE "partner_companies" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "auto_schedule" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;