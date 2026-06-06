import { describe, it, expect } from "vitest";
import { evaluateInstanceLimit, type InstanceUsageMtd } from "./instance-limit-enforcement.js";
import type { StoredInstanceLimit } from "./limits-store.js";

function limit(over: Partial<StoredInstanceLimit> = {}): StoredInstanceLimit {
  return {
    costLimitCents: null,
    tokenLimit: null,
    warnPercent: 80,
    mode: "soft",
    version: 1,
    ...over,
  };
}
const usage = (meteredCostCents: number, subscriptionTokens: number): InstanceUsageMtd => ({
  meteredCostCents,
  subscriptionTokens,
});

describe("evaluateInstanceLimit (metric-aware)", () => {
  it("off mode never warns or blocks", () => {
    const ev = evaluateInstanceLimit(limit({ mode: "off", costLimitCents: 100 }), usage(9999, 9999));
    expect(ev.exceeded).toBe(false);
    expect(ev.warned).toBe(false);
    expect(ev.metric).toBeNull();
  });

  it("enforces COST for metered runs", () => {
    const l = limit({ costLimitCents: 10_000, mode: "hard" });
    expect(evaluateInstanceLimit(l, usage(5_000, 0)).exceeded).toBe(false); // 50%
    expect(evaluateInstanceLimit(l, usage(8_500, 0)).warned).toBe(true); // 85% ≥ 80
    expect(evaluateInstanceLimit(l, usage(8_500, 0)).exceeded).toBe(false);
    const hit = evaluateInstanceLimit(l, usage(10_000, 0));
    expect(hit.exceeded).toBe(true);
    expect(hit.metric).toBe("cost");
  });

  it("enforces TOKENS for subscription runs", () => {
    const l = limit({ tokenLimit: 1_000_000, mode: "hard" });
    expect(evaluateInstanceLimit(l, usage(0, 500_000)).exceeded).toBe(false);
    const hit = evaluateInstanceLimit(l, usage(0, 1_200_000));
    expect(hit.exceeded).toBe(true);
    expect(hit.metric).toBe("tokens");
  });

  it("governs a mixed instance on both axes — the higher-utilisation metric drives", () => {
    const l = limit({ costLimitCents: 10_000, tokenLimit: 1_000_000, mode: "hard" });
    // cost at 40%, tokens at 95% → tokens drives, warns
    const ev = evaluateInstanceLimit(l, usage(4_000, 950_000));
    expect(ev.metric).toBe("tokens");
    expect(ev.warned).toBe(true);
    expect(ev.exceeded).toBe(false);
    // tokens over ceiling → blocks on tokens even though cost is fine
    const over = evaluateInstanceLimit(l, usage(4_000, 1_000_000));
    expect(over.exceeded).toBe(true);
    expect(over.metric).toBe("tokens");
  });

  it("a null ceiling means no cap on that metric", () => {
    // only a token cap; huge metered cost must NOT block
    const l = limit({ costLimitCents: null, tokenLimit: 1_000_000, mode: "hard" });
    const ev = evaluateInstanceLimit(l, usage(9_999_999, 10));
    expect(ev.exceeded).toBe(false);
    expect(ev.metric).toBe("tokens");
  });

  it("soft mode reports warned/exceeded but is the caller's choice to block", () => {
    const l = limit({ costLimitCents: 100, mode: "soft" });
    const ev = evaluateInstanceLimit(l, usage(100, 0));
    expect(ev.exceeded).toBe(true); // observed ≥ ceiling
    expect(ev.mode).toBe("soft"); // caller (getInstanceLimitBlock) only blocks on hard
  });
});
