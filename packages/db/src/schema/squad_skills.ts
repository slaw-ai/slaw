import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const squadSkills = pgTable(
  "squad_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    key: text("key").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(),
    sourceType: text("source_type").notNull().default("local_path"),
    sourceLocator: text("source_locator"),
    sourceRef: text("source_ref"),
    trustLevel: text("trust_level").notNull().default("markdown_only"),
    compatibility: text("compatibility").notNull().default("compatible"),
    fileInventory: jsonb("file_inventory").$type<Array<Record<string, unknown>>>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** when true, this skill is mastered by the control tower (sourceType="botfather"):
     * its body is governed centrally and read-only locally. */
    isTowerManaged: boolean("is_tower_managed").notNull().default(false),
    /** the skill_library.key this was installed from (tower-managed only) */
    towerSkillKey: text("tower_skill_key"),
    /** the tower skill version currently installed locally (refresh when stale) */
    towerSkillVersion: integer("tower_skill_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadKeyUniqueIdx: uniqueIndex("squad_skills_squad_key_idx").on(table.squadId, table.key),
    squadNameIdx: index("squad_skills_squad_name_idx").on(table.squadId, table.name),
    towerKeyIdx: index("squad_skills_tower_key_idx").on(table.towerSkillKey),
  }),
);
