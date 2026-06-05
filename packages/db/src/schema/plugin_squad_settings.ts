import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { plugins } from "./plugins.js";

/**
 * `plugin_squad_settings` table — stores operator-managed plugin settings
 * scoped to a specific squad.
 *
 * This is distinct from `plugin_config`, which stores instance-wide plugin
 * configuration. Each squad can have at most one settings row per plugin.
 *
 * Rows represent explicit overrides from the default squad behavior:
 * - no row => plugin is enabled for the squad by default
 * - row with `enabled = false` => plugin is disabled for that squad
 * - row with `enabled = true` => plugin remains enabled and stores squad settings
 */
export const pluginSquadSettings = pgTable(
  "plugin_squad_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id")
      .notNull()
      .references(() => squads.id, { onDelete: "cascade" }),
    pluginId: uuid("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIdx: index("plugin_squad_settings_squad_idx").on(table.squadId),
    pluginIdx: index("plugin_squad_settings_plugin_idx").on(table.pluginId),
    squadPluginUq: uniqueIndex("plugin_squad_settings_squad_plugin_uq").on(
      table.squadId,
      table.pluginId,
    ),
  }),
);
