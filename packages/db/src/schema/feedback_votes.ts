import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";

export const feedbackVotes = pgTable(
  "feedback_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    authorUserId: text("author_user_id").notNull(),
    vote: text("vote").notNull(),
    reason: text("reason"),
    sharedWithLabs: boolean("shared_with_labs").notNull().default(false),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    consentVersion: text("consent_version"),
    redactionSummary: jsonb("redaction_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIssueIdx: index("feedback_votes_squad_issue_idx").on(table.squadId, table.issueId),
    issueTargetIdx: index("feedback_votes_issue_target_idx").on(table.issueId, table.targetType, table.targetId),
    authorIdx: index("feedback_votes_author_idx").on(table.authorUserId, table.createdAt),
    squadTargetAuthorUniqueIdx: uniqueIndex("feedback_votes_squad_target_author_idx").on(
      table.squadId,
      table.targetType,
      table.targetId,
      table.authorUserId,
    ),
  }),
);
