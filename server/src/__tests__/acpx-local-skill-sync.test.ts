import { describe, expect, it } from "vitest";
import {
  listAcpxSkills,
  syncAcpxSkills,
} from "@slaw-ai/adapter-acpx-local/server";

describe("acpx local skill sync", () => {
  const slawKey = "slaw/slaw/slaw";
  const createAgentKey = "slaw/slaw/slaw-create-agent";

  it("reports ACPX Claude skills as supported runtime-mounted state", async () => {
    const snapshot = await listAcpxSkills({
      agentId: "agent-1",
      squadId: "squad-1",
      adapterType: "acpx_local",
      config: {
        agent: "claude",
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    });

    expect(snapshot.adapterType).toBe("acpx_local");
    expect(snapshot.supported).toBe(true);
    expect(snapshot.mode).toBe("ephemeral");
    expect(snapshot.desiredSkills).toContain(slawKey);
    expect(snapshot.desiredSkills).toContain(createAgentKey);
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.detail).toContain("ACPX Claude session");
    expect(snapshot.warnings).toEqual([]);
  });

  it("reports ACPX Codex skills with Codex home runtime detail", async () => {
    const snapshot = await syncAcpxSkills({
      agentId: "agent-2",
      squadId: "squad-1",
      adapterType: "acpx_local",
      config: {
        agent: "codex",
        slawSkillSync: {
          desiredSkills: ["slaw"],
        },
      },
    }, ["slaw"]);

    expect(snapshot.supported).toBe(true);
    expect(snapshot.mode).toBe("ephemeral");
    expect(snapshot.desiredSkills).toContain(slawKey);
    expect(snapshot.desiredSkills).not.toContain("slaw");
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.detail).toContain("CODEX_HOME/skills/");
    expect(snapshot.warnings).toEqual([]);
  });

  it("keeps ACPX custom skill selection tracked but unsupported", async () => {
    const snapshot = await listAcpxSkills({
      agentId: "agent-3",
      squadId: "squad-1",
      adapterType: "acpx_local",
      config: {
        agent: "custom",
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    });

    expect(snapshot.supported).toBe(false);
    expect(snapshot.mode).toBe("unsupported");
    expect(snapshot.desiredSkills).toContain(slawKey);
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.desired).toBe(true);
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.state).toBe("available");
    expect(snapshot.entries.find((entry) => entry.key === slawKey)?.detail).toContain("stored in Slaw only");
    expect(snapshot.warnings).toContain(
      "Custom ACP commands do not expose a Slaw skill integration contract yet; selected skills are tracked only.",
    );
  });
});
