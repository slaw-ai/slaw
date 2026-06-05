CREATE TABLE IF NOT EXISTS "squad_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"source_type" text DEFAULT 'local_path' NOT NULL,
	"source_locator" text,
	"source_ref" text,
	"trust_level" text DEFAULT 'markdown_only' NOT NULL,
	"compatibility" text DEFAULT 'compatible' NOT NULL,
	"file_inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'squad_skills_squad_id_squads_id_fk') THEN
  ALTER TABLE "squad_skills" ADD CONSTRAINT "squad_skills_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "squad_skills_squad_key_idx" ON "squad_skills" USING btree ("squad_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_skills_squad_name_idx" ON "squad_skills" USING btree ("squad_id","name");
