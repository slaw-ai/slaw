-- 0099: Squad Lead Chat — classify issue rows by thread type.
-- Adds issues.thread_type (free-text, NOT NULL DEFAULT 'issue'). Value 'lead' marks the
-- per-squad Squad Lead Chat thread. There is NO issues.kind column in this schema; issue
-- classification was previously split across work_mode (execution mode) and origin_kind
-- (provenance). thread_type is a dedicated, purpose-built column so Lead threads can be
-- found and excluded from task surfaces without overloading either of those.
--
-- Additive and reversible: existing rows default to 'issue', so behaviour is unchanged
-- until a Lead thread is created.
ALTER TABLE "issues" ADD COLUMN "thread_type" text NOT NULL DEFAULT 'issue';
--> statement-breakpoint
-- At most one Lead thread per squad, and a fast partial-index lookup for it. Matches the
-- leadThreadIdx uniqueIndex declared in packages/db/src/schema/issues.ts.
CREATE UNIQUE INDEX IF NOT EXISTS "issues_squad_lead_thread_uq"
  ON "issues" ("squad_id")
  WHERE "thread_type" = 'lead';
