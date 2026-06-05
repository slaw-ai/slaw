import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listPiSkills,
  syncPiSkills,
} from "@slaw/adapter-pi-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("pi local skill sync", () => {
  const slawKey = "slaw/slaw/slaw";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Slaw skills and installs them into the Pi skills home", async () => {
    const home = await makeTempDir("slaw-pi-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      squadId: "squad-1",
      adapterType: "pi_local",
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    } as const;

    const before = await listPiSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(slawKey);
    expect(before.entries.find((entry) => entry.key === slawKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === slawKey)?.state).toBe("missing");

    const after = await syncPiSkills(ctx, [slawKey]);
    expect(after.entries.find((entry) => entry.key === slawKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".pi", "agent", "skills", "slaw"))).isSymbolicLink()).toBe(true);
  });

  it("keeps required bundled Slaw skills installed even when the desired set is emptied", async () => {
    const home = await makeTempDir("slaw-pi-skill-prune-");
    cleanupDirs.add(home);

    const configuredCtx = {
      agentId: "agent-2",
      squadId: "squad-1",
      adapterType: "pi_local",
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    } as const;

    await syncPiSkills(configuredCtx, [slawKey]);

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

    const after = await syncPiSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(slawKey);
    expect(after.entries.find((entry) => entry.key === slawKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".pi", "agent", "skills", "slaw"))).isSymbolicLink()).toBe(true);
  });
});
