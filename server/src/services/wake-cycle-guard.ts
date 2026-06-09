/**
 * F3 — wake-cycle guard.
 *
 * Problem: agents wake each other (and, on status flips, themselves) via issue
 * comments with no loop detection. Agent A comments mentioning B → B wakes,
 * comments mentioning A → A wakes → forever, with no issue state change in
 * between. See DESIGN-reliability-and-cost-control.md, RC-3.
 *
 * This guard tracks recent automation wake edges per issue. If the same
 * (requester → target) edge fires more than a threshold within a window WITHOUT
 * the issue's state advancing, further auto-wakes on that edge are suppressed
 * and the issue is flagged for human attention. Any real state change
 * (status/assignee/etc.) clears the counters, so productive back-and-forth is
 * never throttled — only sterile ping-pong is.
 *
 * Process-local; the issue-mutation routes run in one server process.
 */

export const WAKE_CYCLE_WINDOW_MS = 5 * 60 * 1000;
/** Max repeats of one (requester→target) edge on one issue within the window. */
export const WAKE_CYCLE_MAX_REPEATS = 4;

interface EdgeRecord {
  count: number;
  firstAt: number;
  lastAt: number;
}

interface IssueWakeState {
  /** Monotonic token; bumped on any real issue state change. */
  stateToken: string | null;
  edges: Map<string, EdgeRecord>;
}

function edgeKey(requesterId: string, targetAgentId: string): string {
  return `${requesterId}->${targetAgentId}`;
}

export class WakeCycleGuard {
  private issues = new Map<string, IssueWakeState>();

  /**
   * Call when an issue's state meaningfully changes (status, assignee, etc.).
   * Resets the cycle counters for that issue so productive work isn't throttled.
   */
  noteStateChange(issueId: string, stateToken: string): void {
    const existing = this.issues.get(issueId);
    if (!existing) {
      this.issues.set(issueId, { stateToken, edges: new Map() });
      return;
    }
    if (existing.stateToken !== stateToken) {
      existing.stateToken = stateToken;
      existing.edges.clear();
    }
  }

  /**
   * Decide whether an automation wake should fire. Returns true to allow, false
   * to suppress. `requesterId` is the actor that triggered the wake (the comment
   * author / mention source); `targetAgentId` is who would be woken.
   */
  shouldAllow(input: {
    issueId: string;
    requesterId: string | null;
    targetAgentId: string;
    now?: number;
  }): boolean {
    // System/user-initiated wakes (no agent requester) are never throttled.
    if (!input.requesterId) return true;
    // Self-edges are handled upstream; don't double-count.
    if (input.requesterId === input.targetAgentId) return true;

    const now = input.now ?? Date.now();
    let state = this.issues.get(input.issueId);
    if (!state) {
      state = { stateToken: null, edges: new Map() };
      this.issues.set(input.issueId, state);
    }

    const key = edgeKey(input.requesterId, input.targetAgentId);
    const rec = state.edges.get(key);
    if (!rec || now - rec.firstAt > WAKE_CYCLE_WINDOW_MS) {
      state.edges.set(key, { count: 1, firstAt: now, lastAt: now });
      return true;
    }

    rec.count += 1;
    rec.lastAt = now;
    if (rec.count > WAKE_CYCLE_MAX_REPEATS) {
      return false;
    }
    return true;
  }

  /** Test/ops helper. */
  reset(): void {
    this.issues.clear();
  }
}

/** Shared process-local instance for the issue routes. */
export const wakeCycleGuard = new WakeCycleGuard();
