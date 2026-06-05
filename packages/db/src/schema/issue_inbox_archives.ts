import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";

export const issueInboxArchives = pgTable(
  "issue_inbox_archives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    userId: text("user_id").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIssueIdx: index("issue_inbox_archives_squad_issue_idx").on(table.squadId, table.issueId),
    squadUserIdx: index("issue_inbox_archives_squad_user_idx").on(table.squadId, table.userId),
    squadIssueUserUnique: uniqueIndex("issue_inbox_archives_squad_issue_user_idx").on(
      table.squadId,
      table.issueId,
      table.userId,
    ),
  }),
);
