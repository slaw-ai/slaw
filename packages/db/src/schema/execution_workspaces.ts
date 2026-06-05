import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";
import { projectWorkspaces } from "./project_workspaces.js";
import { projects } from "./projects.js";

export const executionWorkspaces = pgTable(
  "execution_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectWorkspaceId: uuid("project_workspace_id").references(() => projectWorkspaces.id, { onDelete: "set null" }),
    sourceIssueId: uuid("source_issue_id").references((): AnyPgColumn => issues.id, { onDelete: "set null" }),
    mode: text("mode").notNull(),
    strategyType: text("strategy_type").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    cwd: text("cwd"),
    repoUrl: text("repo_url"),
    baseRef: text("base_ref"),
    branchName: text("branch_name"),
    providerType: text("provider_type").notNull().default("local_fs"),
    providerRef: text("provider_ref"),
    derivedFromExecutionWorkspaceId: uuid("derived_from_execution_workspace_id")
      .references((): AnyPgColumn => executionWorkspaces.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    cleanupEligibleAt: timestamp("cleanup_eligible_at", { withTimezone: true }),
    cleanupReason: text("cleanup_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadProjectStatusIdx: index("execution_workspaces_squad_project_status_idx").on(
      table.squadId,
      table.projectId,
      table.status,
    ),
    squadProjectWorkspaceStatusIdx: index("execution_workspaces_squad_project_workspace_status_idx").on(
      table.squadId,
      table.projectWorkspaceId,
      table.status,
    ),
    squadSourceIssueIdx: index("execution_workspaces_squad_source_issue_idx").on(
      table.squadId,
      table.sourceIssueId,
    ),
    squadLastUsedIdx: index("execution_workspaces_squad_last_used_idx").on(
      table.squadId,
      table.lastUsedAt,
    ),
    squadBranchIdx: index("execution_workspaces_squad_branch_idx").on(
      table.squadId,
      table.branchName,
    ),
  }),
);
