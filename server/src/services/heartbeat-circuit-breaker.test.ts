import { describe, it, expect } from "vitest";
import {
  HeartbeatCircuitBreaker,
  isSharedAccountExhaustion,
  computeOpenUntil,
  CIRCUIT_BREAKER_DEFAULT_COOLOFF_MS,
  CIRCUIT_BREAKER_MAX_COOLOFF_MS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from "./heartbeat-circuit-breaker.js";

describe("isSharedAccountExhaustion", () => {
  it("flags transient_upstream family", () => {
    expect(isSharedAccountExhaustion({ errorFamily: "transient_upstream" })).toBe(true);
  });
  it("flags claude/codex transient error codes", () => {
    expect(isSharedAccountExhaustion({ errorCode: "claude_transient_upstream" })).toBe(true);
    expect(isSharedAccountExhaustion({ errorCode: "codex_transient_upstream" })).toBe(true);
  });
  it("does not flag unrelated errors", () => {
    expect(isSharedAccountExhaustion({ errorCode: "issue_not_found" })).toBe(false);
    expect(isSharedAccountExhaustion({})).toBe(false);
  });
});

describe("computeOpenUntil", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  it("uses the reset hint when present and sane", () => {
    const hint = new Date(now.getTime() + 7 * 60 * 1000);
    expect(computeOpenUntil(now, hint).getTime()).toBe(hint.getTime());
  });
  it("falls back to the default cool-off with no hint", () => {
    expect(computeOpenUntil(now, null).getTime()).toBe(
      now.getTime() + CIRCUIT_BREAKER_DEFAULT_COOLOFF_MS,
    );
  });
  it("clamps an absurd reset hint to the max window", () => {
    const hint = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expect(computeOpenUntil(now, hint).getTime()).toBe(
      now.getTime() + CIRCUIT_BREAKER_MAX_COOLOFF_MS,
    );
  });
  it("never returns a time in the past", () => {
    const hint = new Date(now.getTime() - 60 * 1000);
    expect(computeOpenUntil(now, hint).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("HeartbeatCircuitBreaker", () => {
  it("opens on shared-account exhaustion and reports open until reset", () => {
    const b = new HeartbeatCircuitBreaker();
    const now = new Date("2026-06-10T00:00:00Z");
    const hint = new Date(now.getTime() + 5 * 60 * 1000);
    const res = b.recordFailure({ now, errorFamily: "transient_upstream", resetHint: hint });
    expect(res.tripped).toBe(true);
    expect(res.reason).toBe("shared_account_exhaustion");
    expect(b.isOpen(now)).toBe(true);
    // still open just before reset
    expect(b.isOpen(new Date(hint.getTime() - 1000))).toBe(true);
    // closed at/after reset
    expect(b.isOpen(new Date(hint.getTime() + 1))).toBe(false);
  });

  it("does not double-count tripped when already open", () => {
    const b = new HeartbeatCircuitBreaker();
    const now = new Date("2026-06-10T00:00:00Z");
    const first = b.recordFailure({ now, errorFamily: "transient_upstream" });
    const second = b.recordFailure({
      now: new Date(now.getTime() + 1000),
      errorFamily: "transient_upstream",
    });
    expect(first.tripped).toBe(true);
    expect(second.tripped).toBe(false); // already open
  });

  it("trips via the failure-rate backstop for non-shared errors", () => {
    const b = new HeartbeatCircuitBreaker();
    const now = new Date("2026-06-10T00:00:00Z");
    let tripped = false;
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
      const r = b.recordFailure({
        now: new Date(now.getTime() + i * 1000),
        errorCode: "adapter_failed",
      });
      tripped = tripped || r.tripped;
    }
    expect(tripped).toBe(true);
    expect(b.state().reason).toBe("failure_rate_backstop");
  });

  it("a success clears the backstop counter", () => {
    const b = new HeartbeatCircuitBreaker();
    const now = new Date("2026-06-10T00:00:00Z");
    for (let i = 0; i < CIRCUIT_BREAKER_FAILURE_THRESHOLD - 1; i++) {
      b.recordFailure({ now: new Date(now.getTime() + i * 1000), errorCode: "adapter_failed" });
    }
    b.recordSuccess();
    // one more failure should NOT trip now that the counter reset
    const r = b.recordFailure({
      now: new Date(now.getTime() + 100 * 1000),
      errorCode: "adapter_failed",
    });
    expect(r.tripped).toBe(false);
    expect(b.isOpen()).toBe(false);
  });

  it("reset() clears an open breaker", () => {
    const b = new HeartbeatCircuitBreaker();
    b.recordFailure({ errorFamily: "transient_upstream" });
    expect(b.isOpen()).toBe(true);
    b.reset();
    expect(b.isOpen()).toBe(false);
    expect(b.state().reason).toBeNull();
  });
});
