import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const costEvents = pgTable(
  "cost_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    issueId: uuid("issue_id").references(() => issues.id),
    projectId: uuid("project_id").references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id),
    billingCode: text("billing_code"),
    provider: text("provider").notNull(),
    biller: text("biller").notNull().default("unknown"),
    billingType: text("billing_type").notNull().default("unknown"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadOccurredIdx: index("cost_events_squad_occurred_idx").on(table.squadId, table.occurredAt),
    squadAgentOccurredIdx: index("cost_events_squad_agent_occurred_idx").on(
      table.squadId,
      table.agentId,
      table.occurredAt,
    ),
    squadProviderOccurredIdx: index("cost_events_squad_provider_occurred_idx").on(
      table.squadId,
      table.provider,
      table.occurredAt,
    ),
    squadBillerOccurredIdx: index("cost_events_squad_biller_occurred_idx").on(
      table.squadId,
      table.biller,
      table.occurredAt,
    ),
    squadHeartbeatRunIdx: index("cost_events_squad_heartbeat_run_idx").on(
      table.squadId,
      table.heartbeatRunId,
    ),
  }),
);
