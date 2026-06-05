DROP INDEX "issues_squad_identifier_idx";--> statement-breakpoint

-- Rebuild issue prefixes to be squad-specific and globally unique.
-- Base prefix is first 3 letters of squad name (A-Z only), fallback "CMP".
-- Duplicate bases receive deterministic letter suffixes: PAP, PAPA, PAPAA, ...
WITH ranked_squads AS (
  SELECT
    c.id,
    COALESCE(NULLIF(SUBSTRING(REGEXP_REPLACE(UPPER(c.name), '[^A-Z]', '', 'g') FROM 1 FOR 3), ''), 'CMP') AS base_prefix,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(SUBSTRING(REGEXP_REPLACE(UPPER(c.name), '[^A-Z]', '', 'g') FROM 1 FOR 3), ''), 'CMP')
      ORDER BY c.created_at, c.id
    ) AS prefix_rank
  FROM squads c
)
UPDATE squads c
SET issue_prefix = CASE
  WHEN ranked_squads.prefix_rank = 1 THEN ranked_squads.base_prefix
  ELSE ranked_squads.base_prefix || REPEAT('A', (ranked_squads.prefix_rank - 1)::integer)
END
FROM ranked_squads
WHERE c.id = ranked_squads.id;--> statement-breakpoint

-- Reassign issue numbers sequentially per squad to guarantee uniqueness.
WITH numbered_issues AS (
  SELECT
    i.id,
    ROW_NUMBER() OVER (PARTITION BY i.squad_id ORDER BY i.created_at, i.id) AS issue_number
  FROM issues i
)
UPDATE issues i
SET issue_number = numbered_issues.issue_number
FROM numbered_issues
WHERE i.id = numbered_issues.id;--> statement-breakpoint

-- Rebuild identifiers from normalized prefix + issue number.
UPDATE issues i
SET identifier = c.issue_prefix || '-' || i.issue_number
FROM squads c
WHERE c.id = i.squad_id;--> statement-breakpoint

-- Sync counters to the largest issue number currently assigned per squad.
UPDATE squads c
SET issue_counter = COALESCE((
  SELECT MAX(i.issue_number)
  FROM issues i
  WHERE i.squad_id = c.id
), 0);--> statement-breakpoint

CREATE UNIQUE INDEX "squads_issue_prefix_idx" ON "squads" USING btree ("issue_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_identifier_idx" ON "issues" USING btree ("identifier");
