import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bootstrapDevRunnerWorktreeEnv,
  isLinkedGitWorktreeCheckout,
  resolveWorktreeEnvFilePath,
} from "../dev-runner-worktree.ts";

const tempRoots = new Set<string>();

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

function createTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.add(root);
  return root;
}

describe("dev-runner worktree env bootstrap", () => {
  it("detects linked git worktrees from .git files", () => {
    const root = createTempRoot("slaw-dev-runner-worktree-");
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /tmp/slaw/.git/worktrees/feature\n", "utf8");

    expect(isLinkedGitWorktreeCheckout(root)).toBe(true);
  });

  it("loads repo-local Slaw env for initialized worktrees without overriding explicit env", () => {
    const root = createTempRoot("slaw-dev-runner-worktree-env-");
    fs.mkdirSync(path.join(root, ".slaw"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /tmp/slaw/.git/worktrees/feature\n", "utf8");
    fs.writeFileSync(
      resolveWorktreeEnvFilePath(root),
      [
        "SLAW_HOME=/tmp/slaw-worktrees",
        "SLAW_INSTANCE_ID=feature-worktree",
        "SLAW_IN_WORKTREE=true",
        "SLAW_WORKTREE_NAME=feature-worktree",
        "SLAW_OPTIONAL= # comment-only value",
        "",
      ].join("\n"),
      "utf8",
    );

    const env: NodeJS.ProcessEnv = {
      SLAW_INSTANCE_ID: "already-set",
    };
    const result = bootstrapDevRunnerWorktreeEnv(root, env);

    expect(result).toEqual({
      envPath: resolveWorktreeEnvFilePath(root),
      missingEnv: false,
    });
    expect(env.SLAW_HOME).toBe("/tmp/slaw-worktrees");
    expect(env.SLAW_INSTANCE_ID).toBe("already-set");
    expect(env.SLAW_IN_WORKTREE).toBe("true");
    expect(env.SLAW_OPTIONAL).toBe("");
  });

  it("repairs stale migrated config paths before loading worktree env", () => {
    const root = createTempRoot("slaw-dev-runner-worktree-migrated-env-");
    const localConfigPath = path.join(root, ".slaw", "config.json");
    const worktreesDir = path.join(root, ".slaw-worktrees");
    fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /tmp/slaw/.git/worktrees/feature\n", "utf8");
    fs.writeFileSync(localConfigPath, "{}\n", "utf8");
    fs.writeFileSync(
      resolveWorktreeEnvFilePath(root),
      [
        "SLAW_HOME=/old/home/.slaw-worktrees",
        "SLAW_INSTANCE_ID=feature-worktree",
        "SLAW_CONFIG=/old/home/slaw/.slaw/worktrees/feature/.slaw/config.json",
        "SLAW_CONTEXT=/old/home/.slaw-worktrees/context.json",
        "SLAW_IN_WORKTREE=true",
        "SLAW_WORKTREE_NAME=feature-worktree",
        "",
      ].join("\n"),
      "utf8",
    );

    const env: NodeJS.ProcessEnv = {
      SLAW_WORKTREES_DIR: worktreesDir,
    };
    const result = bootstrapDevRunnerWorktreeEnv(root, env);

    expect(result).toEqual({
      envPath: resolveWorktreeEnvFilePath(root),
      missingEnv: false,
    });
    expect(env.SLAW_HOME).toBe(worktreesDir);
    expect(env.SLAW_CONFIG).toBe(localConfigPath);
    expect(env.SLAW_CONTEXT).toBe(path.join(worktreesDir, "context.json"));
    expect(env.SLAW_INSTANCE_ID).toBe("feature-worktree");
  });

  it("reports uninitialized linked worktrees so dev runner can fail fast", () => {
    const root = createTempRoot("slaw-dev-runner-worktree-missing-");
    fs.writeFileSync(path.join(root, ".git"), "gitdir: /tmp/slaw/.git/worktrees/feature\n", "utf8");

    expect(bootstrapDevRunnerWorktreeEnv(root, {})).toEqual({
      envPath: resolveWorktreeEnvFilePath(root),
      missingEnv: true,
    });
  });
});
