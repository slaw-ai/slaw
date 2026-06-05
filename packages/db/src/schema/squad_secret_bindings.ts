import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";
import { squadSecrets } from "./squad_secrets.js";

export const squadSecretBindings = pgTable(
  "squad_secret_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    secretId: uuid("secret_id").notNull().references(() => squadSecrets.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    configPath: text("config_path").notNull(),
    versionSelector: text("version_selector").notNull().default("latest"),
    required: boolean("required").notNull().default(true),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadIdx: index("squad_secret_bindings_squad_idx").on(table.squadId),
    secretIdx: index("squad_secret_bindings_secret_idx").on(table.secretId),
    targetIdx: index("squad_secret_bindings_target_idx").on(table.squadId, table.targetType, table.targetId),
    targetPathUq: uniqueIndex("squad_secret_bindings_target_path_uq").on(
      table.squadId,
      table.targetType,
      table.targetId,
      table.configPath,
    ),
  }),
);
