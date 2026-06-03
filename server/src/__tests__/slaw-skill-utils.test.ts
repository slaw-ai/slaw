import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listSlawSkillEntries,
  removeMaintainerOnlySkillSymlinks,
} from "@slaw/adapter-utils/server-utils";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("slaw skill utils", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("lists bundled runtime skills from ./skills without pulling in .agents/skills", async () => {
    const root = await makeTempDir("slaw-skill-roots-");
    cleanupDirs.add(root);

    const moduleDir = path.join(root, "a", "b", "c", "d", "e");
    await fs.mkdir(moduleDir, { recursive: true });
    await fs.mkdir(path.join(root, "skills", "slaw"), { recursive: true });
    await fs.mkdir(path.join(root, "skills", "slaw-create-agent"), { recursive: true });
    await fs.mkdir(path.join(root, ".agents", "skills", "release"), { recursive: true });

    const entries = await listSlawSkillEntries(moduleDir);

    expect(entries.map((entry) => entry.key)).toEqual([
      "slaw/slaw/slaw",
      "slaw/slaw/slaw-create-agent",
    ]);
    expect(entries.map((entry) => entry.runtimeName)).toEqual([
      "slaw",
      "slaw-create-agent",
    ]);
    expect(entries[0]?.source).toBe(path.join(root, "skills", "slaw"));
    expect(entries[1]?.source).toBe(path.join(root, "skills", "slaw-create-agent"));
  });

  it("documents artifact uploads in the installed Slaw skill", async () => {
    const skillBody = await fs.readFile(path.resolve("skills/slaw/SKILL.md"), "utf8");
    const referenceBody = await fs.readFile(path.resolve("skills/slaw/references/artifacts.md"), "utf8");

    expect(skillBody).toContain("Generated Artifacts and Work Products");
    expect(skillBody).toContain("references/artifacts.md");
    expect(skillBody).not.toContain("/api/companies/$SLAW_COMPANY_ID/issues/$SLAW_TASK_ID/attachments");
    expect(referenceBody).toContain("Generated Artifacts and Work Products");
    expect(referenceBody).toContain("scripts/slaw-upload-artifact.sh");
    expect(referenceBody).toContain("POST");
    expect(referenceBody).toContain("/api/companies/$SLAW_COMPANY_ID/issues/$SLAW_TASK_ID/attachments");
    expect(referenceBody).toContain("/api/issues/$SLAW_TASK_ID/work-products");
    await expect(
      fs.access(path.resolve("skills/slaw/scripts/slaw-upload-artifact.sh")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.resolve("scripts/slaw-upload-artifact.sh"))).rejects.toThrow();
  });

  it("marks skills with required: false in SKILL.md frontmatter as optional", async () => {
    const root = await makeTempDir("slaw-skill-optional-");
    cleanupDirs.add(root);

    const moduleDir = path.join(root, "a", "b", "c", "d", "e");
    await fs.mkdir(moduleDir, { recursive: true });

    // Required skill (no frontmatter flag)
    const requiredDir = path.join(root, "skills", "slaw");
    await fs.mkdir(requiredDir, { recursive: true });
    await fs.writeFile(path.join(requiredDir, "SKILL.md"), "---\nname: slaw\n---\n\n# Slaw\n");

    // Optional skill (required: false)
    const optionalDir = path.join(root, "skills", "slaw-dev");
    await fs.mkdir(optionalDir, { recursive: true });
    await fs.writeFile(path.join(optionalDir, "SKILL.md"), "---\nname: slaw-dev\nrequired: false\n---\n\n# Dev\n");

    const entries = await listSlawSkillEntries(moduleDir);
    entries.sort((a, b) => a.runtimeName.localeCompare(b.runtimeName));

    expect(entries).toHaveLength(2);
    expect(entries[0]?.runtimeName).toBe("slaw");
    expect(entries[0]?.required).toBe(true);
    expect(entries[1]?.runtimeName).toBe("slaw-dev");
    expect(entries[1]?.required).toBe(false);
    expect(entries[1]?.requiredReason).toBeNull();
  });

  it("removes stale maintainer-only symlinks from a shared skills home", async () => {
    const root = await makeTempDir("slaw-skill-cleanup-");
    cleanupDirs.add(root);

    const skillsHome = path.join(root, "skills-home");
    const runtimeSkill = path.join(root, "skills", "slaw");
    const customSkill = path.join(root, "custom", "release-notes");
    const staleMaintainerSkill = path.join(root, ".agents", "skills", "release");

    await fs.mkdir(skillsHome, { recursive: true });
    await fs.mkdir(runtimeSkill, { recursive: true });
    await fs.mkdir(customSkill, { recursive: true });

    await fs.symlink(runtimeSkill, path.join(skillsHome, "slaw"));
    await fs.symlink(customSkill, path.join(skillsHome, "release-notes"));
    await fs.symlink(staleMaintainerSkill, path.join(skillsHome, "release"));

    const removed = await removeMaintainerOnlySkillSymlinks(skillsHome, ["slaw"]);

    expect(removed).toEqual(["release"]);
    await expect(fs.lstat(path.join(skillsHome, "release"))).rejects.toThrow();
    expect((await fs.lstat(path.join(skillsHome, "slaw"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "release-notes"))).isSymbolicLink()).toBe(true);
  });
});
