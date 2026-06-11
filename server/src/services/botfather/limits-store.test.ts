import { describe, it, expect, vi } from "vitest";
import { shouldApplyLimit, applyDirectives } from "./limits-store.js";
import type { Db } from "@slaw-ai/db";
import type { Directive, LimitSpec } from "@slaw-ai/shared/botfather/protocol";

function spec(version: number, over: Partial<LimitSpec> = {}): LimitSpec {
  return {
    costLimitCents: 50_000,
    tokenLimit: null,
    window: "calendar_month_utc",
    warnPercent: 80,
    mode: "soft",
    version,
    ...over,
  };
}

describe("shouldApplyLimit (monotonic gate)", () => {
  it("applies only a strictly-newer version", () => {
    expect(shouldApplyLimit({ version: 0 }, { version: 1 })).toBe(true);
    expect(shouldApplyLimit({ version: 5 }, { version: 6 })).toBe(true);
    expect(shouldApplyLimit({ version: 5 }, { version: 5 })).toBe(false); // duplicate
    expect(shouldApplyLimit({ version: 5 }, { version: 4 })).toBe(false); // stale
  });
});

/**
 * Fake db that holds one in-memory `instance_limits` row. The store issues two
 * SQL shapes: a SELECT (returns {rows:[current]}) and an INSERT…ON CONFLICT
 * (mutates the held row). We discriminate by the query text.
 */
function fakeDb(initialVersion = 0) {
  let row: Record<string, unknown> | undefined =
    initialVersion > 0
      ? {
          cost_limit_cents: 1,
          token_limit: null,
          warn_percent: 80,
          mode: "soft",
          version: initialVersion,
        }
      : undefined;
  const db = {
    execute: vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("SELECT")) return { rows: row ? [row] : [] };
      // INSERT path: pull the bound params (drizzle sql`` carries them); since
      // our fake can't introspect easily, mark applied by reading the directive
      // captured on the db object.
      row = (db as unknown as { __next?: Record<string, unknown> }).__next ?? row;
      return { rows: [] };
    }),
  } as unknown as Db;
  return { db, setNext: (r: Record<string, unknown>) => ((db as unknown as { __next?: unknown }).__next = r) };
}

describe("applyDirectives", () => {
  it("ignores non-limit directives and an empty list", async () => {
    const { db } = fakeDb(0);
    expect(await applyDirectives(db, [])).toBe(0);
    expect(await applyDirectives(db, undefined)).toBe(0);
    const other: Directive[] = [{ kind: "request_reconciliation" }];
    expect(await applyDirectives(db, other)).toBe(0);
  });

  it("applies a newer set_limits and skips a stale one", async () => {
    // current version 3 in store
    const { db, setNext } = fakeDb(3);
    setNext({ cost_limit_cents: 20_000, token_limit: null, warn_percent: 80, mode: "hard", version: 5 });
    const applyNew = await applyDirectives(db, [{ kind: "set_limits", limit: spec(5, { mode: "hard" }) }]);
    expect(applyNew).toBe(1);

    // a stale push (version 4 < current 5) is ignored
    const applyStale = await applyDirectives(db, [{ kind: "set_limits", limit: spec(4) }]);
    expect(applyStale).toBe(0);
  });
});
