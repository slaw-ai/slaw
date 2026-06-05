import type { IssueCommentAuthorType } from "@slaw/shared";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";
import { documentAnnotationThreads } from "./document_annotation_threads.js";
import { documents } from "./documents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";

export const documentAnnotationComments = pgTable(
  "document_annotation_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    threadId: uuid("thread_id").notNull().references(() => documentAnnotationThreads.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorType: text("author_type").$type<IssueCommentAuthorType>().notNull(),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadThreadCreatedAtIdx: index("document_annotation_comments_squad_thread_created_at_idx").on(
      table.squadId,
      table.threadId,
      table.createdAt,
    ),
    squadIssueCreatedAtIdx: index("document_annotation_comments_squad_issue_created_at_idx").on(
      table.squadId,
      table.issueId,
      table.createdAt,
    ),
    squadDocumentCreatedAtIdx: index("document_annotation_comments_squad_document_created_at_idx").on(
      table.squadId,
      table.documentId,
      table.createdAt,
    ),
    bodySearchIdx: index("document_annotation_comments_body_search_idx").using("gin", table.body.op("gin_trgm_ops")),
  }),
);
