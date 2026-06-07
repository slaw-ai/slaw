ALTER TABLE "squad_skills" ADD COLUMN IF NOT EXISTS "is_tower_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_skills" ADD COLUMN IF NOT EXISTS "tower_skill_key" text;--> statement-breakpoint
ALTER TABLE "squad_skills" ADD COLUMN IF NOT EXISTS "tower_skill_version" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_skills_tower_key_idx" ON "squad_skills" USING btree ("tower_skill_key");
