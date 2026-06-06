CREATE TABLE IF NOT EXISTS "instance_limits" (
	"singleton_key" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"source" text DEFAULT 'tower' NOT NULL,
	"cost_limit_cents" integer,
	"token_limit" bigint,
	"warn_percent" integer DEFAULT 80 NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone
);
