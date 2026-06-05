import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";

export const issueReadStates = pgTable(
  "issue_read_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    userId: text("user_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIssueIdx: index("issue_read_states_squad_issue_idx").on(table.squadId, table.issueId),
    squadUserIdx: index("issue_read_states_squad_user_idx").on(table.squadId, table.userId),
    squadIssueUserUnique: uniqueIndex("issue_read_states_squad_issue_user_idx").on(
      table.squadId,
      table.issueId,
      table.userId,
    ),
  }),
);
