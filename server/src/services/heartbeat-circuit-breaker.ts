/**
 * F1 — Instance-wide heartbeat circuit breaker.
 *
 * Problem this solves: when the shared Claude account hits a usage / rate /
 * overload limit, every agent's heartbeat fails with the SAME systemic error.
 * The old behaviour retried each run independently on a 2m/10m/30m/2h backoff
 * while the 30s scheduler kept spawning fresh chains — so a single account-level
 * limit produced hundreds of failing runs and burned quota for days (see
 * DESIGN-reliability-and-cost-control.md, RC-1).
 *
 * The breaker is an INSTANCE-level gate. When a shared-account-exhaustion error
 * is observed, it "opens" until a computed resume time, and while open the
 * scheduler skips ALL automation wakeups (logging once, not once-per-agent).
 * A separate failure-rate backstop trips the breaker even if classification is
 * wrong, so no future misclassification can reproduce the runaway.
 *
 * State is process-local and intentionally simple: the scheduler runs in a
 * single server process, and the breaker only needs to survive between ticks.
 * It is reset on restart (a restart already implies a human is present).
 */

/** Default cool-off when the upstream gives no explicit reset hint. */
export const CIRCUIT_BREAKER_DEFAULT_COOLOFF_MS = 5 * 60 * 1000;
/** Cap on any single open window, so a bogus reset hint can't park us for days. */
export const CIRCUIT_BREAKER_MAX_COOLOFF_MS = 60 * 60 * 1000;

/**
 * Failure-rate backstop: if this many heartbeat runs fail inside the rolling
 * window — regardless of error classification — trip the breaker anyway.
 */
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 8;
export const CIRCUIT_BREAKER_FAILURE_WINDOW_MS = 10 * 60 * 1000;

export type CircuitBreakerTripReason =
  | "shared_account_exhaustion"
  | "failure_rate_backstop";

export interface CircuitBreakerState {
  openUntil: Date | null;
  reason: CircuitBreakerTripReason | null;
  /** Human-readable detail for the UI banner / logs. */
  detail: string | null;
  trippedAt: Date | null;
}

interface FailureMark {
  at: number;
}

/**
 * Error families that are SHARED across the whole account and therefore must
 * never be retried per-run. These map to the adapter's transient-upstream
 * classification (usage limit reached, rate limit, overloaded, 429/503/529).
 */
const SHARED_ACCOUNT_ERROR_FAMILIES = new Set<string>([
  "transient_upstream",
]);

const SHARED_ACCOUNT_ERROR_CODES = new Set<string>([
  "claude_transient_upstream",
  "codex_transient_upstream",
]);

export function isSharedAccountExhaustion(input: {
  errorFamily?: string | null;
  errorCode?: string | null;
}): boolean {
  if (input.errorFamily && SHARED_ACCOUNT_ERROR_FAMILIES.has(input.errorFamily)) {
    return true;
  }
  if (input.errorCode && SHARED_ACCOUNT_ERROR_CODES.has(input.errorCode)) {
    return true;
  }
  return false;
}

/**
 * Clamp a resume hint into a sane window. `resetHint` is the upstream's
 * "resets at <time>" if we parsed one; otherwise we fall back to the default
 * cool-off. Either way we never park longer than the max.
 */
export function computeOpenUntil(
  now: Date,
  resetHint: Date | null,
): Date {
  const minUntil = now.getTime() + 1_000;
  const maxUntil = now.getTime() + CIRCUIT_BREAKER_MAX_COOLOFF_MS;
  const fallback = now.getTime() + CIRCUIT_BREAKER_DEFAULT_COOLOFF_MS;
  const target = resetHint ? resetHint.getTime() : fallback;
  const clamped = Math.min(maxUntil, Math.max(minUntil, target));
  return new Date(clamped);
}

/**
 * The breaker instance. One per server process; created in the heartbeat
 * service and shared by the scheduler gate and the failure-recording path.
 */
export class HeartbeatCircuitBreaker {
  private openUntil: Date | null = null;
  private reason: CircuitBreakerTripReason | null = null;
  private detail: string | null = null;
  private trippedAt: Date | null = null;
  private failures: FailureMark[] = [];

  /** Is the breaker open (scheduler should skip automation wakeups)? */
  isOpen(now: Date = new Date()): boolean {
    if (!this.openUntil) return false;
    if (now.getTime() >= this.openUntil.getTime()) {
      // Window elapsed — auto-close.
      this.reset();
      return false;
    }
    return true;
  }

  state(): CircuitBreakerState {
    return {
      openUntil: this.openUntil,
      reason: this.reason,
      detail: this.detail,
      trippedAt: this.trippedAt,
    };
  }

  /** Force the breaker open until `until` for an explicit reason. */
  trip(input: {
    now?: Date;
    until: Date;
    reason: CircuitBreakerTripReason;
    detail?: string | null;
  }): void {
    const now = input.now ?? new Date();
    // Extend, never shorten, an existing open window.
    if (this.openUntil && this.openUntil.getTime() > input.until.getTime()) {
      return;
    }
    this.openUntil = input.until;
    this.reason = input.reason;
    this.detail = input.detail ?? null;
    this.trippedAt = now;
  }

  reset(): void {
    this.openUntil = null;
    this.reason = null;
    this.detail = null;
    this.trippedAt = null;
    this.failures = [];
  }

  /**
   * Record a failed heartbeat run. Returns whether the breaker tripped as a
   * result (so the caller can log a single line). Two paths:
   *  1. shared-account exhaustion → open immediately using the reset hint.
   *  2. otherwise → count toward the failure-rate backstop.
   */
  recordFailure(input: {
    now?: Date;
    errorFamily?: string | null;
    errorCode?: string | null;
    resetHint?: Date | null;
    detail?: string | null;
  }): { tripped: boolean; reason: CircuitBreakerTripReason | null } {
    const now = input.now ?? new Date();

    if (isSharedAccountExhaustion(input)) {
      const until = computeOpenUntil(now, input.resetHint ?? null);
      const wasOpen = this.isOpen(now);
      this.trip({
        now,
        until,
        reason: "shared_account_exhaustion",
        detail:
          input.detail ??
          "Claude usage/rate limit reached — pausing all heartbeats until it resets.",
      });
      return { tripped: !wasOpen, reason: "shared_account_exhaustion" };
    }

    // Failure-rate backstop.
    this.failures.push({ at: now.getTime() });
    const cutoff = now.getTime() - CIRCUIT_BREAKER_FAILURE_WINDOW_MS;
    this.failures = this.failures.filter((f) => f.at >= cutoff);
    if (this.failures.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      const wasOpen = this.isOpen(now);
      this.trip({
        now,
        until: computeOpenUntil(now, null),
        reason: "failure_rate_backstop",
        detail:
          input.detail ??
          `${this.failures.length} heartbeat failures in ${Math.round(
            CIRCUIT_BREAKER_FAILURE_WINDOW_MS / 60000,
          )} min — pausing heartbeats to avoid a runaway.`,
      });
      this.failures = [];
      return { tripped: !wasOpen, reason: "failure_rate_backstop" };
    }

    return { tripped: false, reason: null };
  }

  /** A successful run is evidence the upstream is healthy; clear backstop count. */
  recordSuccess(): void {
    this.failures = [];
  }
}
