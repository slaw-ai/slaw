import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { squads } from "./squads.js";

export const squadMemberships = pgTable(
  "squad_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    squadId: uuid("squad_id").notNull().references(() => squads.id),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    status: text("status").notNull().default("active"),
    membershipRole: text("membership_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    squadPrincipalUniqueIdx: uniqueIndex("squad_memberships_squad_principal_unique_idx").on(
      table.squadId,
      table.principalType,
      table.principalId,
    ),
    principalStatusIdx: index("squad_memberships_principal_status_idx").on(
      table.principalType,
      table.principalId,
      table.status,
    ),
    squadStatusIdx: index("squad_memberships_squad_status_idx").on(table.squadId, table.status),
  }),
);
