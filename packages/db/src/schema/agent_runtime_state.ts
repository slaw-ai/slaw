import { pgTable, uuid, text, timestamp, jsonb, bigint, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";

export const agentRuntimeState = pgTable(
  "agent_runtime_state",
  {
    agentId: uuid("agent_id").primaryKey().references(() => agents.id),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    adapterType: text("adapter_type").notNull(),
    sessionId: text("session_id"),
    stateJson: jsonb("state_json").$type<Record<string, unknown>>().notNull().default({}),
    lastRunId: uuid("last_run_id"),
    lastRunStatus: text("last_run_status"),
    totalInputTokens: bigint("total_input_tokens", { mode: "number" }).notNull().default(0),
    totalOutputTokens: bigint("total_output_tokens", { mode: "number" }).notNull().default(0),
    totalCachedInputTokens: bigint("total_cached_input_tokens", { mode: "number" }).notNull().default(0),
    totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadAgentIdx: index("agent_runtime_state_squad_agent_idx").on(table.squadId, table.agentId),
    squadUpdatedIdx: index("agent_runtime_state_squad_updated_idx").on(table.squadId, table.updatedAt),
  }),
);

