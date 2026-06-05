CREATE TABLE IF NOT EXISTS "inbox_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"item_key" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inbox_dismissals" ADD CONSTRAINT "inbox_dismissals_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_dismissals_squad_user_idx" ON "inbox_dismissals" USING btree ("squad_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_dismissals_squad_item_idx" ON "inbox_dismissals" USING btree ("squad_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_dismissals_squad_user_item_idx" ON "inbox_dismissals" USING btree ("squad_id","user_id","item_key");
