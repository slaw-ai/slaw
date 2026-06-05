ALTER TABLE "execution_workspaces" DROP CONSTRAINT "execution_workspaces_squad_id_squads_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_operations" DROP CONSTRAINT "workspace_operations_squad_id_squads_id_fk";
--> statement-breakpoint
ALTER TABLE "execution_workspaces" ADD CONSTRAINT "execution_workspaces_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_squad_id_squads_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squads"("id") ON DELETE cascade ON UPDATE no action;