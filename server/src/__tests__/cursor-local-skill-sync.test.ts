import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCursorSkills,
  syncCursorSkills,
} from "@slaw-ai/adapter-cursor-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createSkillDir(root: string, name: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return skillDir;
}

describe("cursor local skill sync", () => {
  const slawKey = "slaw/slaw/slaw";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Slaw skills and installs them into the Cursor skills home", async () => {
    const home = await makeTempDir("slaw-cursor-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      squadId: "squad-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    } as const;

    const before = await listCursorSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(slawKey);
    expect(before.entries.find((entry) => entry.key === slawKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === slawKey)?.state).toBe("missing");

    const after = await syncCursorSkills(ctx, [slawKey]);
    expect(after.entries.find((entry) => entry.key === slawKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "slaw"))).isSymbolicLink()).toBe(true);
  });

  it("recognizes squad-library runtime skills supplied outside the bundled Slaw directory", async () => {
    const home = await makeTempDir("slaw-cursor-runtime-skills-home-");
    const runtimeSkills = await makeTempDir("slaw-cursor-runtime-skills-src-");
    cleanupDirs.add(home);
    cleanupDirs.add(runtimeSkills);

    const slawDir = await createSkillDir(runtimeSkills, "slaw");
    const asciiHeartDir = await createSkillDir(runtimeSkills, "ascii-heart");

    const ctx = {
      agentId: "agent-3",
      squadId: "squad-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        slawRuntimeSkills: [
          {
            key: "slaw",
            runtimeName: "slaw",
            source: slawDir,
            required: true,
            requiredReason: "Bundled Slaw skills are always available for local adapters.",
          },
          {
            key: "ascii-heart",
            runtimeName: "ascii-heart",
            source: asciiHeartDir,
          },
        ],
        slawSkillSync: {
          desiredSkills: ["ascii-heart"],
        },
      },
    } as const;

    const before = await listCursorSkills(ctx);
    expect(before.warnings).toEqual([]);
    expect(before.desiredSkills).toEqual(["slaw", "ascii-heart"]);
    expect(before.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("missing");

    const after = await syncCursorSkills(ctx, ["ascii-heart"]);
    expect(after.warnings).toEqual([]);
    expect(after.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "ascii-heart"))).isSymbolicLink()).toBe(true);
  });

  it("keeps required bundled Slaw skills installed even when the desired set is emptied", async () => {
    const home = await makeTempDir("slaw-cursor-skill-prune-");
    cleanupDirs.add(home);

    const configuredCtx = {
      agentId: "agent-2",
      squadId: "squad-1",
      adapterType: "cursor",
      config: {
        env: {
          HOME: home,
        },
        slawSkillSync: {
          desiredSkills: [slawKey],
        },
      },
    } as const;

    await syncCursorSkills(configuredCtx, [slawKey]);

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

    const after = await syncCursorSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(slawKey);
    expect(after.entries.find((entry) => entry.key === slawKey)?.state).toBe("installed");
    expect((await fs.lstat(path.join(home, ".cursor", "skills", "slaw"))).isSymbolicLink()).toBe(true);
  });
});
