import { describe, expect, it } from "vitest";

import { createTestHarness } from "../src/testing.js";
import type { SlawPluginManifestV1 } from "../src/types.js";

const manifest = {
  id: "slaw.test-actions",
  apiVersion: 1,
  version: "1.0.0",
  displayName: "Test Actions",
  description: "Test plugin",
  author: "Slaw",
  categories: ["automation"],
  capabilities: [],
  entrypoints: {},
} satisfies SlawPluginManifestV1;

describe("createTestHarness action context", () => {
  it("passes immutable authenticated actor context and overrides caller squad scope", async () => {
    const harness = createTestHarness({ manifest });

    harness.ctx.actions.register("inspect", async (params, context) => ({
      paramsSquadId: params.squadId,
      actor: context.actor,
      squadId: context.squadId,
      contextFrozen: Object.isFrozen(context),
      actorFrozen: Object.isFrozen(context.actor),
    }));

    const result = await harness.performAction<{
      paramsSquadId: unknown;
      actor: {
        type: string;
        userId: string | null;
        agentId: string | null;
        runId: string | null;
        squadId: string | null;
      };
      squadId: string | null;
      contextFrozen: boolean;
      actorFrozen: boolean;
    }>(
      "inspect",
      { squadId: "spoofed-squad", value: true },
      {
        squadId: "host-squad",
        actor: {
          type: "user",
          userId: "board-user-1",
          runId: "run-1",
        },
      },
    );

    expect(result.paramsSquadId).toBe("host-squad");
    expect(result.squadId).toBe("host-squad");
    expect(result.actor).toEqual({
      type: "user",
      userId: "board-user-1",
      agentId: null,
      runId: "run-1",
      squadId: "host-squad",
    });
    expect(result.contextFrozen).toBe(true);
    expect(result.actorFrozen).toBe(true);
  });

  it("keeps existing one-argument action handlers compatible", async () => {
    const harness = createTestHarness({ manifest });
    harness.ctx.actions.register("legacy", async (params) => ({ ok: params.ok }));

    await expect(harness.performAction("legacy", { ok: true })).resolves.toEqual({ ok: true });
  });
});
