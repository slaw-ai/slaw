import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";
import { issues } from "./issues.js";

export const issueRelations = pgTable(
  "issue_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    relatedIssueId: uuid("related_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    type: text("type").$type<"blocks">().notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIssueIdx: index("issue_relations_squad_issue_idx").on(table.squadId, table.issueId),
    squadRelatedIssueIdx: index("issue_relations_squad_related_issue_idx").on(table.squadId, table.relatedIssueId),
    squadTypeIdx: index("issue_relations_squad_type_idx").on(table.squadId, table.type),
    squadEdgeUq: uniqueIndex("issue_relations_squad_edge_uq").on(
      table.squadId,
      table.issueId,
      table.relatedIssueId,
      table.type,
    ),
  }),
);
