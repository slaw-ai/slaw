import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { squadSecrets } from "./squad_secrets.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { plugins } from "./plugins.js";

export const secretAccessEvents = pgTable(
  "secret_access_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    secretId: uuid("secret_id").notNull().references(() => squadSecrets.id, { onDelete: "cascade" }),
    version: integer("version"),
    provider: text("provider").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    consumerType: text("consumer_type").notNull(),
    consumerId: text("consumer_id").notNull(),
    configPath: text("config_path"),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    pluginId: uuid("plugin_id").references(() => plugins.id, { onDelete: "set null" }),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadCreatedIdx: index("secret_access_events_squad_created_idx").on(table.squadId, table.createdAt),
    secretCreatedIdx: index("secret_access_events_secret_created_idx").on(table.secretId, table.createdAt),
    consumerIdx: index("secret_access_events_consumer_idx").on(table.squadId, table.consumerType, table.consumerId),
    runIdx: index("secret_access_events_run_idx").on(table.heartbeatRunId),
  }),
);
