DO $$ BEGIN
 CREATE TYPE "public"."inbox_status" AS ENUM('active', 'expired', 'deleted');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inboxes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inboxes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_id" text NOT NULL,
	"access_secret_hash" text NOT NULL,
	"address" text NOT NULL,
	"local_part" text NOT NULL,
	"domain" text NOT NULL,
	"status" "inbox_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inboxes_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "inboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"inbox_id" integer NOT NULL,
	"delivery_id" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"subject" text DEFAULT '(no subject)' NOT NULL,
	"preview" text DEFAULT '' NOT NULL,
	"text_body" text,
	"html_body" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_inbox_id_inboxes_id_fk" FOREIGN KEY ("inbox_id") REFERENCES "public"."inboxes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inboxes_address" ON "inboxes" USING btree ("address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inboxes_expires_at" ON "inboxes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inboxes_status" ON "inboxes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_inboxes_public_id" ON "inboxes" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_inbox_id" ON "messages" USING btree ("inbox_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_received_at" ON "messages" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_messages_delivery_id" ON "messages" USING btree ("delivery_id");