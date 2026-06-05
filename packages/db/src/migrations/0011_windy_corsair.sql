CREATE TABLE "project_goals" (
	"project_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"squad_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_goals_project_id_goal_id_pk" PRIMARY KEY("project_id","goal_id")
);
--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_goals" ADD CONSTRAINT "project_goals_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_goals_project_idx" ON "project_goals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_goals_goal_idx" ON "project_goals" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "project_goals_squad_idx" ON "project_goals" USING btree ("squad_id");--> statement-breakpoint
INSERT INTO "project_goals" ("project_id", "goal_id", "squad_id")
SELECT "id", "goal_id", "squad_id" FROM "projects" WHERE "goal_id" IS NOT NULL
ON CONFLICT DO NOTHING;