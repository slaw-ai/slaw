CREATE TABLE IF NOT EXISTS "botfather_sync_state" (
	"entity_type" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_synced_id" text,
	"sent_count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
