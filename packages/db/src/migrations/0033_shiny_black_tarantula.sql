ALTER TABLE "squads" ADD COLUMN "pause_reason" text;--> statement-breakpoint
ALTER TABLE "squads" ADD COLUMN "paused_at" timestamp with time zone;
