-- 0098: Retire paperclip-era C-suite agent roles → leads-based roles.
-- The agents.role column is free-text (text NOT NULL DEFAULT 'general'), NOT a
-- Postgres enum, and the value is not used as a cross-table foreign key, so an
-- in-place rekey is safe here (unlike the board→operator actor-id rename in 0097).
-- Idempotent: each UPDATE is a no-op when no rows hold the legacy value.
--   cto → engineering_lead
--   cmo → marketing_lead
--   cfo → finance_lead
UPDATE "agents" SET "role" = 'engineering_lead' WHERE "role" = 'cto';
--> statement-breakpoint
UPDATE "agents" SET "role" = 'marketing_lead' WHERE "role" = 'cmo';
--> statement-breakpoint
UPDATE "agents" SET "role" = 'finance_lead' WHERE "role" = 'cfo';
