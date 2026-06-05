import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";
import { documents } from "./documents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title"),
    format: text("format").notNull().default("markdown"),
    body: text("body").notNull(),
    changeSummary: text("change_summary"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentRevisionUq: uniqueIndex("document_revisions_document_revision_uq").on(
      table.documentId,
      table.revisionNumber,
    ),
    squadDocumentCreatedIdx: index("document_revisions_squad_document_created_idx").on(
      table.squadId,
      table.documentId,
      table.createdAt,
    ),
  }),
);
