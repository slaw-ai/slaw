import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { environments } from "./environments.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";

export const environmentLeases = pgTable(
  "environment_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id").notNull().references(() => environments.id, { onDelete: "cascade" }),
    executionWorkspaceId: uuid("execution_workspace_id").references(() => executionWorkspaces.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    leasePolicy: text("lease_policy").notNull().default("ephemeral"),
    provider: text("provider"),
    providerLeaseId: text("provider_lease_id"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    cleanupStatus: text("cleanup_status"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadEnvironmentStatusIdx: index("environment_leases_squad_environment_status_idx").on(
      table.squadId,
      table.environmentId,
      table.status,
    ),
    squadExecutionWorkspaceIdx: index("environment_leases_squad_execution_workspace_idx").on(
      table.squadId,
      table.executionWorkspaceId,
    ),
    squadIssueIdx: index("environment_leases_squad_issue_idx").on(table.squadId, table.issueId),
    heartbeatRunIdx: index("environment_leases_heartbeat_run_idx").on(table.heartbeatRunId),
    squadLastUsedIdx: index("environment_leases_squad_last_used_idx").on(table.squadId, table.lastUsedAt),
    providerLeaseIdx: index("environment_leases_provider_lease_idx").on(table.providerLeaseId),
  }),
);
