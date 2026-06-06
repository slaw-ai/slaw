import { pgTable, text, integer, bigint, timestamp } from "drizzle-orm/pg-core";

/**
 * The tower-governed budget limit currently in force for THIS instance
 * (singleton). Pushed down from botfather via the heartbeat/sync `set_limits`
 * directive and applied here when its `version` is newer than what we hold.
 *
 * Plan-aware: enforce on COST (cents) for metered/API runs, on TOKENS for
 * subscription runs. Either ceiling may be null (no cap on that metric).
 * This is an ADDITIVE instance-wide ceiling — existing squad/agent budget
 * policies keep working and may be stricter, never looser ("tower caps,
 * local can be stricter").
 */
export const instanceLimits = pgTable("instance_limits", {
  singletonKey: text("singleton_key").primaryKey().default("default"),
  /** provenance — currently always "tower" */
  source: text("source").notNull().default("tower"),
  costLimitCents: integer("cost_limit_cents"),
  tokenLimit: bigint("token_limit", { mode: "number" }),
  warnPercent: integer("warn_percent").notNull().default(80),
  /** off | soft | hard */
  mode: text("mode").notNull().default("off"),
  /** monotonic version of the limit currently applied (de-dupe pushes) */
  version: integer("version").notNull().default(0),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
});
