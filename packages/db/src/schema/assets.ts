import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    provider: text("provider").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    originalFilename: text("original_filename"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadCreatedIdx: index("assets_squad_created_idx").on(table.squadId, table.createdAt),
    squadProviderIdx: index("assets_squad_provider_idx").on(table.squadId, table.provider),
    squadObjectKeyUq: uniqueIndex("assets_squad_object_key_uq").on(table.squadId, table.objectKey),
  }),
);
