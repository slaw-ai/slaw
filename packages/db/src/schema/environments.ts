import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    driver: text("driver").notNull().default("local"),
    status: text("status").notNull().default("active"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadStatusIdx: index("environments_squad_status_idx").on(table.squadId, table.status),
    squadDriverIdx: uniqueIndex("environments_squad_driver_idx")
      .on(table.squadId, table.driver)
      .where(sql`${table.driver} = 'local'`),
    squadNameIdx: index("environments_squad_name_idx").on(table.squadId, table.name),
  }),
);
