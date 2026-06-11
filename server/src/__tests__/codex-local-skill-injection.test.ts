import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCodexSkillsInjected } from "@slaw-ai/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createSlawRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"slaw"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const slawKey = "slaw/slaw/slaw";
  const createAgentKey = "slaw/slaw/slaw-create-agent";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("repairs a Codex Slaw skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("slaw-codex-current-");
    const oldRepo = await makeTempDir("slaw-codex-old-");
    const skillsHome = await makeTempDir("slaw-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createSlawRepoSkill(currentRepo, "slaw");
    await createSlawRepoSkill(currentRepo, "slaw-create-agent");
    await createSlawRepoSkill(oldRepo, "slaw");
    await fs.symlink(path.join(oldRepo, "skills", "slaw"), path.join(skillsHome, "slaw"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: slawKey,
            runtimeName: "slaw",
            source: path.join(currentRepo, "skills", "slaw"),
          },
          {
            key: createAgentKey,
            runtimeName: "slaw-create-agent",
            source: path.join(currentRepo, "skills", "slaw-create-agent"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "slaw"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "slaw")),
    );
    expect(await fs.realpath(path.join(skillsHome, "slaw-create-agent"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "slaw-create-agent")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "slaw"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "slaw-create-agent"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Slaw repo checkouts", async () => {
    const currentRepo = await makeTempDir("slaw-codex-current-");
    const customRoot = await makeTempDir("slaw-codex-custom-");
    const skillsHome = await makeTempDir("slaw-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createSlawRepoSkill(currentRepo, "slaw");
    await createCustomSkill(customRoot, "slaw");
    await fs.symlink(path.join(customRoot, "custom", "slaw"), path.join(skillsHome, "slaw"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: slawKey,
        runtimeName: "slaw",
        source: path.join(currentRepo, "skills", "slaw"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "slaw"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "slaw")),
    );
  });

  it("prunes broken symlinks for unavailable Slaw repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("slaw-codex-current-");
    const oldRepo = await makeTempDir("slaw-codex-old-");
    const skillsHome = await makeTempDir("slaw-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createSlawRepoSkill(currentRepo, "slaw");
    await createSlawRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: slawKey,
          runtimeName: "slaw",
          source: path.join(currentRepo, "skills", "slaw"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Slaw skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("slaw-codex-current-");
    const skillsHome = await makeTempDir("slaw-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createSlawRepoSkill(currentRepo, "slaw");
    await createSlawRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: slawKey,
        runtimeName: "slaw",
        source: path.join(currentRepo, "skills", "slaw"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "slaw"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});
