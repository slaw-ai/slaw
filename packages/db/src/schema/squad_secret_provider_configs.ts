import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";

export const squadSecretProviderConfigs = pgTable(
  "squad_secret_provider_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("ready"),
    isDefault: boolean("is_default").notNull().default(false),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    healthStatus: text("health_status"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
    healthMessage: text("health_message"),
    healthDetails: jsonb("health_details").$type<Record<string, unknown>>(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIdx: index("squad_secret_provider_configs_squad_idx").on(table.squadId),
    squadProviderIdx: index("squad_secret_provider_configs_squad_provider_idx").on(table.squadId, table.provider),
    squadDefaultProviderUq: uniqueIndex("squad_secret_provider_configs_default_uq")
      .on(table.squadId, table.provider)
      .where(sql`${table.isDefault} = true`),
  }),
);
