CREATE TABLE "issue_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"related_issue_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_type_check" CHECK ("type" IN ('blocks'));--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_related_issue_id_issues_id_fk" FOREIGN KEY ("related_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_relations" ADD CONSTRAINT "issue_relations_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_relations_squad_issue_idx" ON "issue_relations" USING btree ("squad_id","issue_id");--> statement-breakpoint
CREATE INDEX "issue_relations_squad_related_issue_idx" ON "issue_relations" USING btree ("squad_id","related_issue_id");--> statement-breakpoint
CREATE INDEX "issue_relations_squad_type_idx" ON "issue_relations" USING btree ("squad_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_relations_squad_edge_uq" ON "issue_relations" USING btree ("squad_id","issue_id","related_issue_id","type");
