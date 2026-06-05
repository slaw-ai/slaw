import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { feedbackVotes } from "./feedback_votes.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const feedbackExports = pgTable(
  "feedback_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    feedbackVoteId: uuid("feedback_vote_id").notNull().references(() => feedbackVotes.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    vote: text("vote").notNull(),
    status: text("status").notNull().default("local_only"),
    destination: text("destination"),
    exportId: text("export_id"),
    consentVersion: text("consent_version"),
    schemaVersion: text("schema_version").notNull().default("slaw-feedback-envelope-v2"),
    bundleVersion: text("bundle_version").notNull().default("slaw-feedback-bundle-v2"),
    payloadVersion: text("payload_version").notNull().default("slaw-feedback-v1"),
    payloadDigest: text("payload_digest"),
    payloadSnapshot: jsonb("payload_snapshot"),
    targetSummary: jsonb("target_summary").notNull(),
    redactionSummary: jsonb("redaction_summary"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    voteUniqueIdx: uniqueIndex("feedback_exports_feedback_vote_idx").on(table.feedbackVoteId),
    squadCreatedIdx: index("feedback_exports_squad_created_idx").on(table.squadId, table.createdAt),
    squadStatusIdx: index("feedback_exports_squad_status_idx").on(table.squadId, table.status, table.createdAt),
    squadIssueIdx: index("feedback_exports_squad_issue_idx").on(table.squadId, table.issueId, table.createdAt),
    squadProjectIdx: index("feedback_exports_squad_project_idx").on(table.squadId, table.projectId, table.createdAt),
    squadAuthorIdx: index("feedback_exports_squad_author_idx").on(table.squadId, table.authorUserId, table.createdAt),
  }),
);
