import type { IssueCommentAuthorType, IssueCommentMetadata, IssueCommentPresentation } from "@slaw/shared";
import { pgTable, uuid, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const issueComments = pgTable(
  "issue_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    authorAgentId: uuid("author_agent_id").references(() => agents.id),
    authorUserId: text("author_user_id"),
    authorType: text("author_type").$type<IssueCommentAuthorType>(),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    presentation: jsonb("presentation").$type<IssueCommentPresentation | null>(),
    metadata: jsonb("metadata").$type<IssueCommentMetadata | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueIdx: index("issue_comments_issue_idx").on(table.issueId),
    squadIdx: index("issue_comments_squad_idx").on(table.squadId),
    squadIssueCreatedAtIdx: index("issue_comments_squad_issue_created_at_idx").on(
      table.squadId,
      table.issueId,
      table.createdAt,
    ),
    squadAuthorIssueCreatedAtIdx: index("issue_comments_squad_author_issue_created_at_idx").on(
      table.squadId,
      table.authorUserId,
      table.issueId,
      table.createdAt,
    ),
    bodySearchIdx: index("issue_comments_body_search_idx").using("gin", table.body.op("gin_trgm_ops")),
  }),
);
