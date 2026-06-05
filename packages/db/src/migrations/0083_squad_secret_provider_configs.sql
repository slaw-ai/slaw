CREATE TABLE IF NOT EXISTS "squad_secret_provider_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health_status" text,
	"health_checked_at" timestamp with time zone,
	"health_message" text,
	"health_details" jsonb,
	"disabled_at" timestamp with time zone,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'squad_secret_provider_configs_squad_id_squads_id_fk') THEN
		ALTER TABLE "squad_secret_provider_configs" ADD CONSTRAINT "squad_secret_provider_configs_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'squad_secret_provider_configs_created_by_agent_id_agents_id_fk') THEN
		ALTER TABLE "squad_secret_provider_configs" ADD CONSTRAINT "squad_secret_provider_configs_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
UPDATE "squad_secrets"
SET "provider_config_id" = NULL
WHERE "provider_config_id" IS NOT NULL
	AND "provider_config_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
--> statement-breakpoint
ALTER TABLE "squad_secrets" ALTER COLUMN "provider_config_id" TYPE uuid USING "provider_config_id"::uuid;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'squad_secrets_provider_config_id_squad_secret_provider_configs_id_fk') THEN
		ALTER TABLE "squad_secrets" ADD CONSTRAINT "squad_secrets_provider_config_id_squad_secret_provider_configs_id_fk" FOREIGN KEY ("provider_config_id") REFERENCES "public"."squad_secret_provider_configs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_secret_provider_configs_squad_idx" ON "squad_secret_provider_configs" USING btree ("squad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_secret_provider_configs_squad_provider_idx" ON "squad_secret_provider_configs" USING btree ("squad_id","provider");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "squad_secret_provider_configs_default_uq" ON "squad_secret_provider_configs" USING btree ("squad_id","provider") WHERE "is_default" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "squad_secrets_provider_config_idx" ON "squad_secrets" USING btree ("provider_config_id");
