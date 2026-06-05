import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";

export const heartbeatRunWatchdogDecisions = pgTable(
  "heartbeat_run_watchdog_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    evaluationIssueId: uuid("evaluation_issue_id").references(() => issues.id, { onDelete: "set null" }),
    decision: text("decision").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    reason: text("reason"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadRunCreatedIdx: index("heartbeat_run_watchdog_decisions_squad_run_created_idx").on(
      table.squadId,
      table.runId,
      table.createdAt,
    ),
    squadRunSnoozeIdx: index("heartbeat_run_watchdog_decisions_squad_run_snooze_idx").on(
      table.squadId,
      table.runId,
      table.snoozedUntil,
    ),
  }),
);
