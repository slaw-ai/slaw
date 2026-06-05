import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";

export const agentMemberships = pgTable(
  "agent_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("joined"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadUserIdx: index("agent_memberships_squad_user_idx").on(table.squadId, table.userId),
    agentIdx: index("agent_memberships_agent_idx").on(table.agentId),
    squadUserAgentUq: uniqueIndex("agent_memberships_squad_user_agent_uq").on(
      table.squadId,
      table.userId,
      table.agentId,
    ),
  }),
);
