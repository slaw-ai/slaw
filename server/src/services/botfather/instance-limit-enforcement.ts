import { sql } from "drizzle-orm";
import type { Db } from "@slaw/db";
import { readInstanceLimit, type StoredInstanceLimit } from "./limits-store.js";

/**
 * Enforcement for the tower-pushed INSTANCE-WIDE budget limit. This is an
 * additive ceiling layered on top of the existing squad/agent budget policies
 * ("tower caps, local can be stricter"). It is plan-aware: metered/API runs are
 * measured in COST (cents); subscription runs are measured in TOKENS (cost ≈ $0
 * there). An instance running a mix is governed on both axes at once.
 */

export interface InstanceUsageMtd {
  /** sum of cost_cents for metered_api rows this calendar month (UTC) */
  meteredCostCents: number;
  /** sum of input+cached+output tokens for subscription rows this month */
  subscriptionTokens: number;
}

const SUBSCRIPTION_TYPES = ["subscription_included", "subscription_overage"];

/** Current month-to-date metered cost (cents) and subscription tokens, instance-wide. */
export async function computeInstanceUsageMtd(db: Db): Promise<InstanceUsageMtd> {
  const res = await db.execute(sql`
    SELECT
      coalesce(sum(case when billing_type = 'metered_api' then cost_cents else 0 end), 0)::double precision
        AS metered_cost_cents,
      coalesce(sum(case when billing_type in ('subscription_included','subscription_overage')
        then input_tokens + cached_input_tokens + output_tokens else 0 end), 0)::double precision
        AS subscription_tokens
    FROM cost_events
    WHERE occurred_at >= date_trunc('month', now() at time zone 'utc')
  `);
  const rows = (res as { rows?: Record<string, unknown>[] }).rows ?? (res as Record<string, unknown>[]);
  const r = Array.isArray(rows) ? rows[0] : undefined;
  return {
    meteredCostCents: Number(r?.metered_cost_cents ?? 0),
    subscriptionTokens: Number(r?.subscription_tokens ?? 0),
  };
}

export type LimitMetric = "cost" | "tokens";

export interface LimitEvaluation {
  /** is any ceiling hit at/over 100%? (block when mode === hard) */
  exceeded: boolean;
  /** is any ceiling at/over warnPercent? */
  warned: boolean;
  /** which metric drove the highest utilisation (for messaging) */
  metric: LimitMetric | null;
  /** observed / ceiling for the driving metric */
  observed: number;
  ceiling: number | null;
  percent: number;
  mode: StoredInstanceLimit["mode"];
}

/** Pure evaluation of usage against a stored limit — testable without a DB. */
export function evaluateInstanceLimit(
  limit: StoredInstanceLimit,
  usage: InstanceUsageMtd,
): LimitEvaluation {
  const base: LimitEvaluation = {
    exceeded: false,
    warned: false,
    metric: null,
    observed: 0,
    ceiling: null,
    percent: 0,
    mode: limit.mode,
  };
  if (limit.mode === "off") return base;

  const candidates: Array<{ metric: LimitMetric; observed: number; ceiling: number | null }> = [
    { metric: "cost", observed: usage.meteredCostCents, ceiling: limit.costLimitCents },
    { metric: "tokens", observed: usage.subscriptionTokens, ceiling: limit.tokenLimit },
  ];

  let driver = base;
  for (const c of candidates) {
    if (c.ceiling == null || c.ceiling <= 0) continue;
    const percent = (c.observed / c.ceiling) * 100;
    const exceeded = c.observed >= c.ceiling;
    const warned = percent >= limit.warnPercent;
    // keep the metric with the highest utilisation as the driver
    if (percent >= driver.percent) {
      driver = {
        exceeded,
        warned,
        metric: c.metric,
        observed: c.observed,
        ceiling: c.ceiling,
        percent: Math.round(percent),
        mode: limit.mode,
      };
    }
  }
  return driver;
}

export interface InstanceLimitBlock {
  reason: string;
  metric: LimitMetric;
}

/**
 * Returns a block when the tower limit is in HARD mode and a ceiling is hit.
 * Soft/off modes never block here (they warn at cost-event time instead).
 * Used as an additive gate at the top of getInvocationBlock.
 */
export async function getInstanceLimitBlock(db: Db): Promise<InstanceLimitBlock | null> {
  const limit = await readInstanceLimit(db);
  if (limit.mode !== "hard") return null;
  const usage = await computeInstanceUsageMtd(db);
  const ev = evaluateInstanceLimit(limit, usage);
  if (!ev.exceeded || !ev.metric) return null;
  const human =
    ev.metric === "cost"
      ? `$${(ev.observed / 100).toFixed(2)} of $${((ev.ceiling ?? 0) / 100).toFixed(2)}`
      : `${Math.round(ev.observed).toLocaleString()} of ${(ev.ceiling ?? 0).toLocaleString()} tokens`;
  return {
    metric: ev.metric,
    reason: `Control-tower budget limit reached for this instance (${human}). New work is blocked until the limit resets or is raised.`,
  };
}
