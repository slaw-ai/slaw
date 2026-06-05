import { index, pgTable, text, timestamp, uniqueIndex, uuid, boolean, integer } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { squads } from "./squads.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { issueTreeHolds } from "./issue_tree_holds.js";

export const issueTreeHoldMembers = pgTable(
  "issue_tree_hold_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    holdId: uuid("hold_id").notNull().references(() => issueTreeHolds.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    parentIssueId: uuid("parent_issue_id").references(() => issues.id, { onDelete: "set null" }),
    depth: integer("depth").notNull().default(0),
    issueIdentifier: text("issue_identifier"),
    issueTitle: text("issue_title").notNull(),
    issueStatus: text("issue_status").notNull(),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    assigneeUserId: text("assignee_user_id"),
    activeRunId: uuid("active_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    activeRunStatus: text("active_run_status"),
    skipped: boolean("skipped").notNull().default(false),
    skipReason: text("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    holdIssueUniqueIdx: uniqueIndex("issue_tree_hold_members_hold_issue_uq").on(table.holdId, table.issueId),
    squadIssueIdx: index("issue_tree_hold_members_squad_issue_idx").on(table.squadId, table.issueId),
    holdDepthIdx: index("issue_tree_hold_members_hold_depth_idx").on(table.holdId, table.depth),
  }),
);
