import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";
import { issues } from "./issues.js";

export const issueRecoveryActions = pgTable(
  "issue_recovery_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    sourceIssueId: uuid("source_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    recoveryIssueId: uuid("recovery_issue_id").references(() => issues.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("active"),
    ownerType: text("owner_type").notNull().default("agent"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    ownerUserId: text("owner_user_id"),
    previousOwnerAgentId: uuid("previous_owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    returnOwnerAgentId: uuid("return_owner_agent_id").references(() => agents.id, { onDelete: "set null" }),
    cause: text("cause").notNull(),
    fingerprint: text("fingerprint").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    nextAction: text("next_action").notNull(),
    wakePolicy: jsonb("wake_policy").$type<Record<string, unknown>>(),
    monitorPolicy: jsonb("monitor_policy").$type<Record<string, unknown>>(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts"),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    outcome: text("outcome"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadSourceStatusIdx: index("issue_recovery_actions_squad_source_status_idx").on(
      table.squadId,
      table.sourceIssueId,
      table.status,
    ),
    squadOwnerStatusIdx: index("issue_recovery_actions_squad_owner_status_idx").on(
      table.squadId,
      table.ownerAgentId,
      table.status,
    ),
    squadRecoveryIssueIdx: index("issue_recovery_actions_squad_recovery_issue_idx").on(
      table.squadId,
      table.recoveryIssueId,
    ),
    activeSourceIdx: uniqueIndex("issue_recovery_actions_active_source_uq")
      .on(table.squadId, table.sourceIssueId)
      .where(sql`${table.status} in ('active', 'escalated')`),
    activeFingerprintIdx: uniqueIndex("issue_recovery_actions_active_fingerprint_uq")
      .on(table.squadId, table.sourceIssueId, table.cause, table.fingerprint)
      .where(sql`${table.status} in ('active', 'escalated')`),
  }),
);
