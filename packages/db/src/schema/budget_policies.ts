import { boolean, index, integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const budgetPolicies = pgTable(
  "budget_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    metric: text("metric").notNull().default("billed_cents"),
    windowKind: text("window_kind").notNull(),
    amount: integer("amount").notNull().default(0),
    warnPercent: integer("warn_percent").notNull().default(80),
    hardStopEnabled: boolean("hard_stop_enabled").notNull().default(true),
    notifyEnabled: boolean("notify_enabled").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadScopeActiveIdx: index("budget_policies_squad_scope_active_idx").on(
      table.squadId,
      table.scopeType,
      table.scopeId,
      table.isActive,
    ),
    squadWindowIdx: index("budget_policies_squad_window_idx").on(
      table.squadId,
      table.windowKind,
      table.metric,
    ),
    squadScopeMetricUniqueIdx: uniqueIndex("budget_policies_squad_scope_metric_unique_idx").on(
      table.squadId,
      table.scopeType,
      table.scopeId,
      table.metric,
      table.windowKind,
    ),
  }),
);
