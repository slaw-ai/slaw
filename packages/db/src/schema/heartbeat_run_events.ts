import { pgTable, uuid, text, timestamp, integer, jsonb, index, bigserial } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const heartbeatRunEvents = pgTable(
  "heartbeat_run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    stream: text("stream"),
    level: text("level"),
    color: text("color"),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runSeqIdx: index("heartbeat_run_events_run_seq_idx").on(table.runId, table.seq),
    squadRunIdx: index("heartbeat_run_events_squad_run_idx").on(table.squadId, table.runId),
    squadCreatedIdx: index("heartbeat_run_events_squad_created_idx").on(table.squadId, table.createdAt),
  }),
);

