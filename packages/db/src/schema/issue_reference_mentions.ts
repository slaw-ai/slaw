import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";

export const issueReferenceMentions = pgTable(
  "issue_reference_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    sourceIssueId: uuid("source_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    targetIssueId: uuid("target_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").$type<"title" | "description" | "comment" | "document">().notNull(),
    sourceRecordId: uuid("source_record_id"),
    documentKey: text("document_key"),
    matchedText: text("matched_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadSourceIssueIdx: index("issue_reference_mentions_squad_source_issue_idx").on(
      table.squadId,
      table.sourceIssueId,
    ),
    squadTargetIssueIdx: index("issue_reference_mentions_squad_target_issue_idx").on(
      table.squadId,
      table.targetIssueId,
    ),
    squadIssuePairIdx: index("issue_reference_mentions_squad_issue_pair_idx").on(
      table.squadId,
      table.sourceIssueId,
      table.targetIssueId,
    ),
    squadSourceMentionWithRecordUq: uniqueIndex("issue_reference_mentions_squad_source_mention_record_uq").on(
      table.squadId,
      table.sourceIssueId,
      table.targetIssueId,
      table.sourceKind,
      table.sourceRecordId,
    ).where(sql`${table.sourceRecordId} is not null`),
    squadSourceMentionWithoutRecordUq: uniqueIndex("issue_reference_mentions_squad_source_mention_null_record_uq").on(
      table.squadId,
      table.sourceIssueId,
      table.targetIssueId,
      table.sourceKind,
    ).where(sql`${table.sourceRecordId} is null`),
  }),
);
