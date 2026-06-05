-- Add issue identifier columns to squads
ALTER TABLE "squads" ADD COLUMN "issue_prefix" text NOT NULL DEFAULT 'PAP';--> statement-breakpoint
ALTER TABLE "squads" ADD COLUMN "issue_counter" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- Add issue identifier columns to issues
ALTER TABLE "issues" ADD COLUMN "issue_number" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "identifier" text;--> statement-breakpoint

-- Backfill existing issues: assign sequential issue_number per squad ordered by created_at
WITH numbered AS (
  SELECT id, squad_id, ROW_NUMBER() OVER (PARTITION BY squad_id ORDER BY created_at ASC) AS rn
  FROM issues
)
UPDATE issues
SET issue_number = numbered.rn,
    identifier = (SELECT issue_prefix FROM squads WHERE squads.id = issues.squad_id) || '-' || numbered.rn
FROM numbered
WHERE issues.id = numbered.id;--> statement-breakpoint

-- Sync each squad's issue_counter to the max assigned number
UPDATE squads
SET issue_counter = COALESCE(
  (SELECT MAX(issue_number) FROM issues WHERE issues.squad_id = squads.id),
  0
);--> statement-breakpoint

-- Create unique index on (squad_id, identifier)
CREATE UNIQUE INDEX "issues_squad_identifier_idx" ON "issues" USING btree ("squad_id","identifier");
