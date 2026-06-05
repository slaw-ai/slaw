import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listGeminiSkills,
  syncGeminiSkills,
} from "@slaw/adapter-gemini-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("gemini local skill sync", () => {
  const slawKey = "slaw/slaw/slaw";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Slaw skills and installs them into the Gemini skills home", async () => {
    const home = await makeTempDir("slaw-gemini-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      squadId: "squad-1",
      adapterType: "gemini_local",
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    } as const;

    const before = await listGeminiSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(slawKey);
    expect(before.entries.find((entry) => entry.key === slawKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === slawKey)?.state).toBe("missing");

    const after = await syncGeminiSkills(ctx, [slawKey]);
    expect(after.entries.find((entry) => entry.key === slawKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".gemini", "skills", "slaw"))).isSymbolicLink()).toBe(true);
  });

  it("keeps required bundled Slaw skills installed even when the desired set is emptied", async () => {
    const home = await makeTempDir("slaw-gemini-skill-prune-");
    cleanupDirs.add(home);

    const configuredCtx = {
      agentId: "agent-2",
      squadId: "squad-1",
      adapterType: "gemini_local",
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    } as const;

    await syncGeminiSkills(configuredCtx, [slawKey]);

    const clearedCtx = {
      ...configuredCtx,
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncGeminiSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(slawKey);
    expect(after.entries.find((entry) => entry.key === slawKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".gemini", "skills", "slaw"))).isSymbolicLink()).toBe(true);
  });
});
