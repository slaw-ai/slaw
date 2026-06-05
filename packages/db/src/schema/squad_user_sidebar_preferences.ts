import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const squadUserSidebarPreferences = pgTable(
  "squad_user_sidebar_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    projectOrder: jsonb("project_order").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIdx: index("squad_user_sidebar_preferences_squad_idx").on(table.squadId),
    userIdx: index("squad_user_sidebar_preferences_user_idx").on(table.userId),
    squadUserUq: uniqueIndex("squad_user_sidebar_preferences_squad_user_uq").on(
      table.squadId,
      table.userId,
    ),
  }),
);
