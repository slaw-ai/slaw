import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const principalPermissionGrants = pgTable(
  "principal_permission_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    scope: jsonb("scope").$type<Record<string, unknown> | null>(),
    grantedByUserId: text("granted_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueGrantIdx: uniqueIndex("principal_permission_grants_unique_idx").on(
      table.squadId,
      table.principalType,
      table.principalId,
      table.permissionKey,
    ),
    squadPermissionIdx: index("principal_permission_grants_squad_permission_idx").on(
      table.squadId,
      table.permissionKey,
    ),
  }),
);
