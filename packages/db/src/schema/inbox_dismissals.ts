import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const inboxDismissals = pgTable(
  "inbox_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    userId: text("user_id").notNull(),
    itemKey: text("item_key").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadUserIdx: index("inbox_dismissals_squad_user_idx").on(table.squadId, table.userId),
    squadItemIdx: index("inbox_dismissals_squad_item_idx").on(table.squadId, table.itemKey),
    squadUserItemUnique: uniqueIndex("inbox_dismissals_squad_user_item_idx").on(
      table.squadId,
      table.userId,
      table.itemKey,
    ),
  }),
);
