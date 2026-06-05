import { pgTable, text, timestamp, bigint } from "drizzle-orm/pg-core";

/**
 * Per-instance cursor state for the botfather reporter (ARCHITECTURE §4.3).
 * One row per entity type ("squad" | "agent" | "project" | "issue" |
 * "cost_event" | "run_event" | "activity_event"). Tracks the high-water mark
 * already acknowledged by the tower so the reporter only sends new deltas.
 *
 * Entity upserts watermark on updatedAt; append-only facts watermark on a
 * monotonic (occurredAt, id) cursor. We store both an ISO timestamp and an
 * opaque lastId so either strategy can advance.
 */
export const botfatherSyncState = pgTable("botfather_sync_state", {
  entityType: text("entity_type").primaryKey(),
  // last updatedAt/occurredAt acknowledged by the tower (ISO 8601)
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  // last row id acknowledged (tie-breaker within the same timestamp)
  lastSyncedId: text("last_synced_id"),
  // total rows ever sent for this entity type (diagnostics)
  sentCount: bigint("sent_count", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
