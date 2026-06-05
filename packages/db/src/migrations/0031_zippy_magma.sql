CREATE TABLE "finance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"agent_id" uuid,
	"issue_id" uuid,
	"project_id" uuid,
	"goal_id" uuid,
	"heartbeat_run_id" uuid,
	"cost_event_id" uuid,
	"billing_code" text,
	"description" text,
	"event_kind" text NOT NULL,
	"direction" text DEFAULT 'debit' NOT NULL,
	"biller" text NOT NULL,
	"provider" text,
	"execution_adapter_type" text,
	"pricing_tier" text,
	"region" text,
	"model" text,
	"quantity" integer,
	"unit" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"external_invoice_id" text,
	"metadata_json" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "heartbeat_run_id" uuid;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "biller" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "billing_type" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_events" ADD COLUMN "cached_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_events" ADD CONSTRAINT "finance_events_cost_event_id_cost_events_id_fk" FOREIGN KEY ("cost_event_id") REFERENCES "public"."cost_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_events_squad_occurred_idx" ON "finance_events" USING btree ("squad_id","occurred_at");--> statement-breakpoint
CREATE INDEX "finance_events_squad_biller_occurred_idx" ON "finance_events" USING btree ("squad_id","biller","occurred_at");--> statement-breakpoint
CREATE INDEX "finance_events_squad_kind_occurred_idx" ON "finance_events" USING btree ("squad_id","event_kind","occurred_at");--> statement-breakpoint
CREATE INDEX "finance_events_squad_direction_occurred_idx" ON "finance_events" USING btree ("squad_id","direction","occurred_at");--> statement-breakpoint
CREATE INDEX "finance_events_squad_heartbeat_run_idx" ON "finance_events" USING btree ("squad_id","heartbeat_run_id");--> statement-breakpoint
CREATE INDEX "finance_events_squad_cost_event_idx" ON "finance_events" USING btree ("squad_id","cost_event_id");--> statement-breakpoint
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_events_squad_provider_occurred_idx" ON "cost_events" USING btree ("squad_id","provider","occurred_at");--> statement-breakpoint
CREATE INDEX "cost_events_squad_biller_occurred_idx" ON "cost_events" USING btree ("squad_id","biller","occurred_at");--> statement-breakpoint
CREATE INDEX "cost_events_squad_heartbeat_run_idx" ON "cost_events" USING btree ("squad_id","heartbeat_run_id");