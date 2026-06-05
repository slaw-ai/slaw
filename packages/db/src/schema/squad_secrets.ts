import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { agents } from "./agents.js";
import { squadSecretProviderConfigs } from "./squad_secret_provider_configs.js";

export const squadSecrets = pgTable(
  "squad_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("local_encrypted"),
    status: text("status").notNull().default("active"),
    managedMode: text("managed_mode").notNull().default("slaw_managed"),
    externalRef: text("external_ref"),
    providerConfigId: uuid("provider_config_id").references(() => squadSecretProviderConfigs.id, { onDelete: "set null" }),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
    latestVersion: integer("latest_version").notNull().default(1),
    description: text("description"),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIdx: index("squad_secrets_squad_idx").on(table.squadId),
    squadProviderIdx: index("squad_secrets_squad_provider_idx").on(table.squadId, table.provider),
    providerConfigIdx: index("squad_secrets_provider_config_idx").on(table.providerConfigId),
    squadNameUq: uniqueIndex("squad_secrets_squad_name_uq").on(table.squadId, table.name),
    squadKeyUq: uniqueIndex("squad_secrets_squad_key_uq").on(table.squadId, table.key),
  }),
);
