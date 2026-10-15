DO $$ BEGIN
 CREATE TYPE "public"."inbox_category" AS ENUM('work', 'school', 'personal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "inboxes" ADD COLUMN "category" "inbox_category" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "inboxes" ADD COLUMN "is_custom_username" boolean DEFAULT false NOT NULL;