import { describe, expect, it } from "vitest";
import {
  listGrokSkills,
  syncGrokSkills,
} from "@slaw-ai/adapter-grok-local/server";

describe("grok local skill sync", () => {
  const slawKey = "slaw/slaw/slaw";
  const createAgentKey = "slaw/slaw/slaw-create-agent";

  it("reports Grok skills as ephemeral workspace-mounted state", async () => {
    const snapshot = await listGrokSkills({
      agentId: "agent-1",
      squadId: "squad-1",
      adapterType: "grok_local",
      config: {
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    });

    expect(snapshot.adapterType).toBe("grok_local");
    expect(snapshot.supported).toBe(true);
    expect(snapshot.mode).toBe("ephemeral");
    expect(snapshot.desiredSkills).toContain(slawKey);
    expect(snapshot.desiredSkills).toContain(createAgentKey);
    expect(snapshot.entries.find((entry) => entry.key === slawKey)).toMatchObject({
      required: true,
      state: "configured",
      detail: "Will be copied into `.claude/skills` in the execution workspace on the next run.",
    });
  });

  it("tracks unavailable desired Grok skills as missing without persistent install state", async () => {
    const snapshot = await syncGrokSkills({
      agentId: "agent-2",
      squadId: "squad-1",
      adapterType: "grok_local",
      config: {
        slawRuntimeSkills: [],
        slawSkillSync: {
          desiredSkills: ["unknown-skill"],
        },
      },
    }, ["unknown-skill"]);

    expect(snapshot.mode).toBe("ephemeral");
    expect(snapshot.warnings).toContain(
      'Desired skill "unknown-skill" is not available from the Slaw skills directory.',
    );
    expect(snapshot.entries).toContainEqual(expect.objectContaining({
      key: "unknown-skill",
      state: "missing",
      origin: "external_unknown",
      targetPath: null,
    }));
  });
});
