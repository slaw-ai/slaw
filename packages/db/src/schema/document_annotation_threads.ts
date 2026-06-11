import type {
  DocumentAnnotationAnchorConfidence,
  DocumentAnnotationAnchorSelector,
  DocumentAnnotationAnchorState,
  DocumentAnnotationThreadStatus,
} from "@slaw-ai/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";
import { documentRevisions } from "./document_revisions.js";
import { documents } from "./documents.js";
import { issues } from "./issues.js";

export const documentAnnotationThreads = pgTable(
  "document_annotation_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    documentKey: text("document_key").notNull(),
    status: text("status").$type<DocumentAnnotationThreadStatus>().notNull().default("open"),
    anchorState: text("anchor_state").$type<DocumentAnnotationAnchorState>().notNull().default("active"),
    originalRevisionId: uuid("original_revision_id").references(() => documentRevisions.id, { onDelete: "set null" }),
    originalRevisionNumber: integer("original_revision_number").notNull(),
    currentRevisionId: uuid("current_revision_id").references(() => documentRevisions.id, { onDelete: "set null" }),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    selectedText: text("selected_text").notNull(),
    prefixText: text("prefix_text").notNull().default(""),
    suffixText: text("suffix_text").notNull().default(""),
    normalizedStart: integer("normalized_start").notNull(),
    normalizedEnd: integer("normalized_end").notNull(),
    markdownStart: integer("markdown_start").notNull(),
    markdownEnd: integer("markdown_end").notNull(),
    anchorConfidence: text("anchor_confidence")
      .$type<DocumentAnnotationAnchorConfidence>()
      .notNull()
      .default("exact"),
    anchorSelector: jsonb("anchor_selector").$type<DocumentAnnotationAnchorSelector>().notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    resolvedByAgentId: uuid("resolved_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    resolvedByUserId: text("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadDocumentStatusIdx: index("document_annotation_threads_squad_document_status_idx").on(
      table.squadId,
      table.documentId,
      table.status,
    ),
    squadIssueStatusIdx: index("document_annotation_threads_squad_issue_status_idx").on(
      table.squadId,
      table.issueId,
      table.status,
    ),
    squadCurrentRevisionOpenIdx: index("document_annotation_threads_squad_current_revision_open_idx").on(
      table.squadId,
      table.documentId,
      table.currentRevisionId,
      table.status,
    ),
    squadAnchorStateIdx: index("document_annotation_threads_squad_anchor_state_idx").on(
      table.squadId,
      table.anchorState,
    ),
  }),
);
