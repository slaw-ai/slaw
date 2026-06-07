import { beforeEach, describe, expect, it, vi } from "vitest";
import { squadService } from "../services/squads.ts";
import { agentService } from "../services/agents.ts";

function createSelectSequenceDb(results: unknown[]) {
  const pending = [...results];
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    then: vi.fn((resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(pending.shift() ?? []))),
  };

  return {
    db: {
      select: vi.fn(() => chain),
    },
  };
}

describe("monthly spend hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recomputes squad spentMonthlyCents from the current utc month instead of returning stale stored values", async () => {
    const dbStub = createSelectSequenceDb([
      [{
        id: "squad-1",
        name: "Slaw",
        description: null,
        status: "active",
        issuePrefix: "PAP",
        issueCounter: 1,
        budgetMonthlyCents: 5000,
        spentMonthlyCents: 999999,
        requireOperatorApprovalForNewAgents: false,
        brandColor: null,
        logoAssetId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      [{
        squadId: "squad-1",
        spentMonthlyCents: 420,
      }],
    ]);

    const squads = squadService(dbStub.db as any);
    const [squad] = await squads.list();

    expect(squad.spentMonthlyCents).toBe(420);
  });

  it("recomputes agent spentMonthlyCents from the current utc month instead of returning stale stored values", async () => {
    const dbStub = createSelectSequenceDb([
      [{
        id: "agent-1",
        squadId: "squad-1",
        name: "Budget Agent",
        role: "general",
        title: null,
        reportsTo: null,
        capabilities: null,
        adapterType: "claude-local",
        adapterConfig: {},
        runtimeConfig: {},
        budgetMonthlyCents: 5000,
        spentMonthlyCents: 999999,
        metadata: null,
        permissions: null,
        status: "idle",
        pauseReason: null,
        pausedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      [{
        agentId: "agent-1",
        spentMonthlyCents: 175,
      }],
    ]);

    const agents = agentService(dbStub.db as any);
    const agent = await agents.getById("agent-1");

    expect(agent?.spentMonthlyCents).toBe(175);
  });
});
