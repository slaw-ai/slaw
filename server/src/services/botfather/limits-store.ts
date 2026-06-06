import { sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { instanceLimits } from "@slaw/db";
import type { Directive, LimitSpec } from "@slaw/shared/botfather/protocol";

const SINGLETON = "default";

export interface StoredInstanceLimit {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent: number;
  mode: "off" | "soft" | "hard";
  version: number;
}

const OFF: StoredInstanceLimit = {
  costLimitCents: null,
  tokenLimit: null,
  warnPercent: 80,
  mode: "off",
  version: 0,
};

/**
 * Pure monotonic gate: a pushed limit is applied only when its version is
 * strictly newer than what we hold. Stale/duplicate pushes are ignored. Kept
 * pure so it's unit-testable without a database.
 */
export function shouldApplyLimit(current: { version: number }, pushed: { version: number }): boolean {
  return pushed.version > current.version;
}

/** Read the currently-applied tower limit for this instance (singleton). */
export async function readInstanceLimit(db: Db): Promise<StoredInstanceLimit> {
  // Defensive: if the table doesn't exist yet (pre-migration) or the db handle
  // can't run raw SQL, treat as "no limit" rather than throwing — limit
  // enforcement must never break run-gating or cost ingestion.
  if (typeof (db as { execute?: unknown }).execute !== "function") return OFF;
  let res: unknown;
  try {
    res = await db.execute(sql`
      SELECT cost_limit_cents, token_limit, warn_percent, mode, version
      FROM instance_limits WHERE singleton_key = ${SINGLETON} LIMIT 1
    `);
  } catch {
    return OFF;
  }
  const rows = (res as { rows?: Record<string, unknown>[] }).rows ?? (res as Record<string, unknown>[]);
  const r = Array.isArray(rows) ? rows[0] : undefined;
  if (!r) return OFF;
  return {
    costLimitCents: r.cost_limit_cents == null ? null : Number(r.cost_limit_cents),
    tokenLimit: r.token_limit == null ? null : Number(r.token_limit),
    warnPercent: Number(r.warn_percent ?? 80),
    mode: (r.mode as StoredInstanceLimit["mode"]) ?? "off",
    version: Number(r.version ?? 0),
  };
}

/** The limit version currently applied (for the heartbeat de-dupe echo). */
export async function appliedLimitVersion(db: Db): Promise<number> {
  return (await readInstanceLimit(db)).version;
}

/**
 * Apply a tower-pushed limit. Idempotent + monotonic: only writes when the
 * pushed version is newer than what we hold, so duplicate/stale pushes are
 * ignored. Returns true if it applied a change.
 */
export async function applyLimitSpec(db: Db, spec: LimitSpec): Promise<boolean> {
  const current = await readInstanceLimit(db);
  if (!shouldApplyLimit(current, spec)) return false;
  await db.execute(sql`
    INSERT INTO instance_limits
      (singleton_key, source, cost_limit_cents, token_limit, warn_percent, mode, version, applied_at)
    VALUES
      (${SINGLETON}, 'tower', ${spec.costLimitCents}, ${spec.tokenLimit},
       ${spec.warnPercent}, ${spec.mode}, ${spec.version}, now())
    ON CONFLICT (singleton_key) DO UPDATE SET
      source = 'tower',
      cost_limit_cents = EXCLUDED.cost_limit_cents,
      token_limit = EXCLUDED.token_limit,
      warn_percent = EXCLUDED.warn_percent,
      mode = EXCLUDED.mode,
      version = EXCLUDED.version,
      applied_at = now()
  `);
  return true;
}

/**
 * Apply any directives carried on a heartbeat/sync response. Currently handles
 * `set_limits`; other directive kinds are accepted and ignored (logged by the
 * caller) so the back-channel stays forward-compatible.
 */
export async function applyDirectives(db: Db, directives: Directive[] | undefined): Promise<number> {
  if (!directives?.length) return 0;
  let applied = 0;
  for (const d of directives) {
    if (d.kind === "set_limits") {
      if (await applyLimitSpec(db, d.limit)) applied += 1;
    }
  }
  return applied;
}
