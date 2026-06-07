-- 0097: Retire "board" governance terminology → "operator".
-- Idempotent: safe on fresh DBs (renames skipped if already applied) and existing dev DBs.

-- Rename board_api_keys → operator_api_keys + its indexes
ALTER TABLE IF EXISTS "board_api_keys" RENAME TO "operator_api_keys";
--> statement-breakpoint
ALTER INDEX IF EXISTS "board_api_keys_key_hash_idx" RENAME TO "operator_api_keys_key_hash_idx";
--> statement-breakpoint
ALTER INDEX IF EXISTS "board_api_keys_user_idx" RENAME TO "operator_api_keys_user_idx";
--> statement-breakpoint

-- Rename the FK column on cli_auth_challenges if it still has the old name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cli_auth_challenges' AND column_name = 'board_api_key_id'
  ) THEN
    ALTER TABLE "cli_auth_challenges" RENAME COLUMN "board_api_key_id" TO "operator_api_key_id";
  END IF;
END $$;
--> statement-breakpoint

-- Rekey the implicit local actor id on pre-existing dev DBs (local-board → local-operator)
UPDATE "instance_user_roles" SET "user_id" = 'local-operator' WHERE "user_id" = 'local-board';
--> statement-breakpoint
UPDATE "squad_memberships" SET "principal_id" = 'local-operator'
  WHERE "principal_type" = 'user' AND "principal_id" = 'local-board';
--> statement-breakpoint

-- Rename squads.require_board_approval_for_new_agents → require_operator_approval_for_new_agents
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'squads' AND column_name = 'require_board_approval_for_new_agents'
  ) THEN
    ALTER TABLE "squads" RENAME COLUMN "require_board_approval_for_new_agents" TO "require_operator_approval_for_new_agents";
  END IF;
END $$;
--> statement-breakpoint

-- cli_auth_challenges.requested_access: migrate stored value + default ('board' → 'operator')
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cli_auth_challenges' AND column_name = 'requested_access'
  ) THEN
    ALTER TABLE "cli_auth_challenges" ALTER COLUMN "requested_access" DROP DEFAULT;
    UPDATE "cli_auth_challenges" SET "requested_access" = 'operator' WHERE "requested_access" = 'board';
    ALTER TABLE "cli_auth_challenges" ALTER COLUMN "requested_access" SET DEFAULT 'operator';
  END IF;
END $$;
