ALTER TABLE "admin_users" ADD COLUMN "username" text NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_username_chk" CHECK ("admin_users"."username" ~ '^[a-z0-9][a-z0-9_.-]{2,31}$');