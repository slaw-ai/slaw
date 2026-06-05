CREATE TABLE "squad_secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"material" jsonb NOT NULL,
	"value_sha256" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "squad_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"external_ref" text,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squad_secret_versions" ADD CONSTRAINT "squad_secret_versions_secret_id_squad_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."squad_secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_secret_versions" ADD CONSTRAINT "squad_secret_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_secrets" ADD CONSTRAINT "squad_secrets_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_secrets" ADD CONSTRAINT "squad_secrets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_secret_versions_secret_idx" ON "squad_secret_versions" USING btree ("secret_id","created_at");--> statement-breakpoint
CREATE INDEX "squad_secret_versions_value_sha256_idx" ON "squad_secret_versions" USING btree ("value_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_secret_versions_secret_version_uq" ON "squad_secret_versions" USING btree ("secret_id","version");--> statement-breakpoint
CREATE INDEX "squad_secrets_squad_idx" ON "squad_secrets" USING btree ("squad_id");--> statement-breakpoint
CREATE INDEX "squad_secrets_squad_provider_idx" ON "squad_secrets" USING btree ("squad_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "squad_secrets_squad_name_uq" ON "squad_secrets" USING btree ("squad_id","name");