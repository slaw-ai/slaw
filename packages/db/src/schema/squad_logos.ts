import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { assets } from "./assets.js";

export const squadLogos = pgTable(
  "squad_logos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadUq: uniqueIndex("squad_logos_squad_uq").on(table.squadId),
    assetUq: uniqueIndex("squad_logos_asset_uq").on(table.assetId),
  }),
);
