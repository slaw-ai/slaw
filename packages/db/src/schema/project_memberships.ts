import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { projects } from "./projects.js";

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("joined"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadUserIdx: index("project_memberships_squad_user_idx").on(table.squadId, table.userId),
    projectIdx: index("project_memberships_project_idx").on(table.projectId),
    squadUserProjectUq: uniqueIndex("project_memberships_squad_user_project_uq").on(
      table.squadId,
      table.userId,
      table.projectId,
    ),
  }),
);
