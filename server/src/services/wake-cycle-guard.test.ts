import { describe, it, expect } from "vitest";
import { WakeCycleGuard, WAKE_CYCLE_MAX_REPEATS, WAKE_CYCLE_WINDOW_MS } from "./wake-cycle-guard.js";

describe("WakeCycleGuard", () => {
  it("allows system/user-initiated wakes (no agent requester) unconditionally", () => {
    const g = new WakeCycleGuard();
    for (let i = 0; i < 100; i++) {
      expect(g.shouldAllow({ issueId: "i1", requesterId: null, targetAgentId: "b" })).toBe(true);
    }
  });

  it("allows up to the threshold then suppresses a repeated A->B edge", () => {
    const g = new WakeCycleGuard();
    const now = Date.now();
    const calls: boolean[] = [];
    for (let i = 0; i <= WAKE_CYCLE_MAX_REPEATS + 1; i++) {
      calls.push(
        g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + i }),
      );
    }
    // The guard allows the edge while count <= MAX_REPEATS, i.e. the first
    // WAKE_CYCLE_MAX_REPEATS attempts; the next one trips the suppression.
    const allowedCount = calls.filter(Boolean).length;
    expect(allowedCount).toBe(WAKE_CYCLE_MAX_REPEATS);
    expect(calls[calls.length - 1]).toBe(false);
  });

  it("a real state change resets the counters (productive back-and-forth is not throttled)", () => {
    const g = new WakeCycleGuard();
    const now = Date.now();
    for (let i = 0; i < WAKE_CYCLE_MAX_REPEATS + 2; i++) {
      g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + i });
    }
    // suppressed now
    expect(g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + 50 })).toBe(false);
    // state advances -> counters clear -> allowed again
    g.noteStateChange("i1", "in_progress:agent-b");
    expect(g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + 60 })).toBe(true);
  });

  it("counts edges independently per issue and per direction", () => {
    const g = new WakeCycleGuard();
    const now = Date.now();
    // saturate A->B on issue i1
    for (let i = 0; i < WAKE_CYCLE_MAX_REPEATS + 2; i++) {
      g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + i });
    }
    expect(g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + 99 })).toBe(false);
    // B->A on the same issue is a different edge -> allowed
    expect(g.shouldAllow({ issueId: "i1", requesterId: "b", targetAgentId: "a", now: now + 99 })).toBe(true);
    // A->B on a different issue -> allowed
    expect(g.shouldAllow({ issueId: "i2", requesterId: "a", targetAgentId: "b", now: now + 99 })).toBe(true);
  });

  it("resets the edge window after it elapses", () => {
    const g = new WakeCycleGuard();
    const now = Date.now();
    for (let i = 0; i < WAKE_CYCLE_MAX_REPEATS + 2; i++) {
      g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + i });
    }
    expect(g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: now + 50 })).toBe(false);
    // after the window, the edge record is stale -> allowed again
    const later = now + WAKE_CYCLE_WINDOW_MS + 1;
    expect(g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "b", now: later })).toBe(true);
  });

  it("never throttles a self-edge (handled upstream)", () => {
    const g = new WakeCycleGuard();
    const now = Date.now();
    for (let i = 0; i < 50; i++) {
      expect(
        g.shouldAllow({ issueId: "i1", requesterId: "a", targetAgentId: "a", now: now + i }),
      ).toBe(true);
    }
  });
});
