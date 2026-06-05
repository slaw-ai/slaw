import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { issues } from "./issues.js";
import { documents } from "./documents.js";

export const issueDocuments = pgTable(
  "issue_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIssueKeyUq: uniqueIndex("issue_documents_squad_issue_key_uq").on(
      table.squadId,
      table.issueId,
      table.key,
    ),
    documentUq: uniqueIndex("issue_documents_document_uq").on(table.documentId),
    squadIssueUpdatedIdx: index("issue_documents_squad_issue_updated_idx").on(
      table.squadId,
      table.issueId,
      table.updatedAt,
    ),
  }),
);
