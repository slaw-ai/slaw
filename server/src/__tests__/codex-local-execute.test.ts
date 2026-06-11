import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runChildProcess } from "@slaw-ai/adapter-utils/server-utils";
import { execute } from "@slaw-ai/adapter-codex-local/server";

async function writeFakeCodexCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.SLAW_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  codexHome: process.env.CODEX_HOME || null,
  slawWakePayloadJson: process.env.SLAW_WAKE_PAYLOAD_JSON || null,
  slawApiUrl: process.env.SLAW_API_URL || null,
  slawApiKey: process.env.SLAW_API_KEY || null,
  slawApiBridgeMode: process.env.SLAW_API_BRIDGE_MODE || null,
  slawEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("SLAW_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

async function writeFailingCodexCommand(commandPath: string, errorMessage: string): Promise<void> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "error", message: ${JSON.stringify(errorMessage)} }));
process.exit(1);
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  prompt: string;
  codexHome: string | null;
  slawWakePayloadJson: string | null;
  slawApiUrl?: string | null;
  slawApiKey?: string | null;
  slawApiBridgeMode?: string | null;
  slawEnvKeys: string[];
};

type LogEntry = {
  stream: "stdout" | "stderr";
  chunk: string;
};

function createLocalSandboxRunner() {
  let counter = 0;
  return {
    execute: async (input: {
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      stdin?: string;
      timeoutMs?: number;
      onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
      onSpawn?: (meta: { pid: number; startedAt: string }) => Promise<void>;
    }) => {
      counter += 1;
      return runChildProcess(
        `sandbox-run-${counter}`,
        input.command,
        input.args ?? [],
        {
          cwd: input.cwd ?? process.cwd(),
          env: input.env ?? {},
          stdin: input.stdin,
          timeoutSec: Math.max(1, Math.ceil((input.timeoutMs ?? 30_000) / 1000)),
          graceSec: 5,
          onLog: input.onLog ?? (async () => {}),
          onSpawn: input.onSpawn
            ? async (meta) => input.onSpawn?.({ pid: meta.pid, startedAt: meta.startedAt })
            : undefined,
        },
      );
    },
  };
}

describe("codex execute", () => {
  it("uses a Slaw-managed CODEX_HOME outside worktree mode while preserving shared auth and config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-default-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const slawHome = path.join(root, "slaw-home");
    const managedCodexHome = path.join(
      slawHome,
      "instances",
      "default",
      "squads",
      "squad-1",
      "codex-home",
    );
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await fs.writeFile(path.join(sharedCodexHome, "config.toml"), 'model = "codex-mini-latest"\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousSlawHome = process.env.SLAW_HOME;
    const previousSlawInstanceId = process.env.SLAW_INSTANCE_ID;
    const previousSlawInWorktree = process.env.SLAW_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.SLAW_HOME = slawHome;
    delete process.env.SLAW_INSTANCE_ID;
    delete process.env.SLAW_IN_WORKTREE;
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-default",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(managedCodexHome);

      const managedAuth = path.join(managedCodexHome, "auth.json");
      const managedConfig = path.join(managedCodexHome, "config.toml");
      expect((await fs.lstat(managedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedAuth)).toBe(await fs.realpath(path.join(sharedCodexHome, "auth.json")));
      expect((await fs.lstat(managedConfig)).isFile()).toBe(true);
      expect(await fs.readFile(managedConfig, "utf8")).toBe('model = "codex-mini-latest"\n');
      await expect(fs.lstat(path.join(sharedCodexHome, "squads", "squad-1"))).rejects.toThrow();
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining("Using Slaw-managed Codex home"),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousSlawHome === undefined) delete process.env.SLAW_HOME;
      else process.env.SLAW_HOME = previousSlawHome;
      if (previousSlawInstanceId === undefined) delete process.env.SLAW_INSTANCE_ID;
      else process.env.SLAW_INSTANCE_ID = previousSlawInstanceId;
      if (previousSlawInWorktree === undefined) delete process.env.SLAW_IN_WORKTREE;
      else process.env.SLAW_IN_WORKTREE = previousSlawInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("emits a command note that Codex auto-applies repo-scoped AGENTS.md files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-notes-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    let commandNotes: string[] = [];
    try {
      const result = await execute({
        runId: "run-notes",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          commandNotes = Array.isArray(meta.commandNotes) ? meta.commandNotes : [];
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(commandNotes).toContain(
        "Codex exec automatically applies repo-scoped AGENTS.md instructions from the current workspace; Slaw does not currently suppress that discovery.",
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("logs HOME and the resolved executable path in invocation metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-meta-"));
    const workspace = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    process.env.HOME = root;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;

    let loggedCommand: string | null = null;
    let loggedEnv: Record<string, string> = {};
    try {
      const result = await execute({
        runId: "run-meta",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "codex",
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          loggedCommand = meta.command;
          loggedEnv = meta.env ?? {};
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(loggedCommand).toBe(commandPath);
      expect(loggedEnv.HOME).toBe(root);
      expect(loggedEnv.SLAW_RESOLVED_COMMAND).toBe(commandPath);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects bridge env into sandbox-managed remote runs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-sandbox-"));
    const localWorkspace = path.join(root, "workspace");
    const remoteWorkspace = path.join(root, "sandbox");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "codex");
    const capturePath = path.join(remoteWorkspace, "capture.json");
    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;

    await fs.mkdir(localWorkspace, { recursive: true });
    await fs.mkdir(remoteWorkspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    process.env.HOME = root;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;

    try {
      const result = await execute({
        runId: "run-sandbox-auth",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: localWorkspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        executionTarget: {
          kind: "remote",
          transport: "sandbox",
          providerKey: "e2b",
          environmentId: "env-1",
          leaseId: "lease-1",
          remoteCwd: remoteWorkspace,
          timeoutMs: 30_000,
          runner: createLocalSandboxRunner(),
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(path.join(remoteWorkspace, ".slaw-runtime", "codex", "home"));
      expect(capture.slawApiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(capture.slawApiKey).not.toBe("run-jwt-token");
      expect(capture.slawApiBridgeMode).toBe("queue_v1");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects structured Slaw wake payloads into env and prompt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-wake-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const result = await execute({
        runId: "run-wake",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {
          issueId: "issue-1",
          taskId: "issue-1",
          wakeReason: "issue_commented",
          wakeCommentId: "comment-2",
          slawWake: {
            reason: "issue_commented",
            issue: {
              id: "issue-1",
              identifier: "PAP-874",
              title: "chat-speed issues",
              status: "in_progress",
              priority: "medium",
            },
            commentIds: ["comment-1", "comment-2"],
            latestCommentId: "comment-2",
            comments: [
              {
                id: "comment-1",
                issueId: "issue-1",
                body: "First comment",
                bodyTruncated: false,
                createdAt: "2026-03-28T14:35:00.000Z",
                author: { type: "user", id: "user-1" },
              },
              {
                id: "comment-2",
                issueId: "issue-1",
                body: "Second comment",
                bodyTruncated: false,
                createdAt: "2026-03-28T14:35:10.000Z",
                author: { type: "user", id: "user-1" },
              },
            ],
            commentWindow: {
              requestedCount: 2,
              includedCount: 2,
              missingCount: 0,
            },
            truncated: false,
            fallbackFetchNeeded: false,
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.slawEnvKeys).toContain("SLAW_WAKE_PAYLOAD_JSON");
      expect(capture.slawWakePayloadJson).not.toBeNull();
      expect(JSON.parse(capture.slawWakePayloadJson ?? "{}")).toMatchObject({
        reason: "issue_commented",
        latestCommentId: "comment-2",
        commentIds: ["comment-1", "comment-2"],
      });
      expect(capture.prompt).toContain("## Slaw Wake Payload");
      expect(capture.prompt).toContain("Treat this wake payload as the highest-priority change for the current heartbeat.");
      expect(capture.prompt).toContain("Do not switch to another issue until you have handled this wake.");
      expect(capture.prompt).toContain(
        "acknowledge the latest comment and explain how it changes your next action.",
      );
      expect(capture.prompt).toContain("First comment");
      expect(capture.prompt).toContain("Second comment");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("classifies remote-compaction high-demand failures as retryable transient upstream errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-transient-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    await fs.mkdir(workspace, { recursive: true });
    await writeFailingCodexCommand(
      commandPath,
      "Error running remote compact task: We're currently experiencing high demand, which may cause temporary errors.",
    );

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const result = await execute({
        runId: "run-transient-error",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(1);
      expect(result.errorCode).toBe("codex_transient_upstream");
      expect(result.errorFamily).toBe("transient_upstream");
      expect(result.errorMessage).toContain("high demand");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("persists retry-not-before metadata for codex usage-limit failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-usage-limit-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    await fs.mkdir(workspace, { recursive: true });
    await writeFailingCodexCommand(
      commandPath,
      "You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 11:31 PM.",
    );

    const previousHome = process.env.HOME;
    process.env.HOME = root;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 22, 22, 29, 0));

    try {
      const result = await execute({
        runId: "run-usage-limit",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: "codex-session-usage-limit",
          sessionParams: {
            sessionId: "codex-session-usage-limit",
            cwd: workspace,
          },
          sessionDisplayId: "codex-session-usage-limit",
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          model: "gpt-5.3-codex-spark",
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(1);
      expect(result.errorCode).toBe("codex_transient_upstream");
      expect(result.errorFamily).toBe("transient_upstream");
      const expectedRetryNotBefore = new Date(2026, 3, 22, 23, 31, 0, 0).toISOString();
      expect(result.retryNotBefore).toBe(expectedRetryNotBefore);
      expect(result.resultJson?.retryNotBefore).toBe(expectedRetryNotBefore);
      expect(new Date(String(result.resultJson?.transientRetryNotBefore)).getTime()).toBe(
        new Date(2026, 3, 22, 23, 31, 0, 0).getTime(),
      );
    } finally {
      vi.useRealTimers();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses safer invocation settings and a fresh-session handoff for codex transient fallback retries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-fallback-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    let commandNotes: string[] = [];
    try {
      const result = await execute({
        runId: "run-fallback",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: {
            sessionId: "codex-session-stale",
            cwd: workspace,
          },
          sessionDisplayId: "codex-session-stale",
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          fastMode: true,
          model: "gpt-5.4",
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {
          codexTransientFallbackMode: "fresh_session_safer_invocation",
          slawContinuationSummary: {
            key: "continuation-summary",
            title: "Continuation Summary",
            body: "Issue continuation summary for the next fresh session.",
            updatedAt: "2026-04-21T01:00:00.000Z",
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          commandNotes = meta.commandNotes ?? [];
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).toEqual(expect.arrayContaining(["exec", "--json", "-"]));
      expect(capture.argv).not.toContain("resume");
      expect(capture.argv).not.toContain('service_tier="fast"');
      expect(capture.argv).not.toContain("features.fast_mode=true");
      expect(capture.prompt).toContain("Slaw session handoff:");
      expect(capture.prompt).toContain("Issue continuation summary for the next fresh session.");
      expect(commandNotes).toContain("Codex transient fallback requested safer invocation settings for this retry.");
      expect(commandNotes).toContain("Codex transient fallback forced a fresh session with a continuation handoff.");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("renders execution-stage wake instructions for reviewer and executor roles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-stage-wake-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const result = await execute({
        runId: "run-stage-wake",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {
          issueId: "issue-1",
          taskId: "issue-1",
          wakeReason: "execution_review_requested",
          slawWake: {
            reason: "execution_review_requested",
            issue: {
              id: "issue-1",
              identifier: "PAP-1207",
              title: "implement the plan of PAP-1200",
              status: "in_review",
              priority: "medium",
            },
            executionStage: {
              wakeRole: "reviewer",
              stageId: "stage-1",
              stageType: "review",
              currentParticipant: { type: "agent", agentId: "qa-agent" },
              returnAssignee: { type: "agent", agentId: "coder-agent" },
              lastDecisionOutcome: null,
              allowedActions: ["approve", "request_changes"],
            },
            commentIds: [],
            latestCommentId: null,
            comments: [],
            commentWindow: {
              requestedCount: 0,
              includedCount: 0,
              missingCount: 0,
            },
            truncated: false,
            fallbackFetchNeeded: false,
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.prompt).toContain("execution wake role: reviewer");
      expect(capture.prompt).toContain("You are waking as the active reviewer for this issue.");
      expect(capture.prompt).toContain("Do not execute the task itself or continue executor work.");
      expect(capture.prompt).toContain("allowed actions: approve, request_changes");

      const executorCapturePath = path.join(root, "capture-executor.json");
      const executorResult = await execute({
        runId: "run-stage-wake-executor",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: executorCapturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {
          issueId: "issue-1",
          taskId: "issue-1",
          wakeReason: "execution_changes_requested",
          slawWake: {
            reason: "execution_changes_requested",
            issue: {
              id: "issue-1",
              identifier: "PAP-1207",
              title: "implement the plan of PAP-1200",
              status: "in_progress",
              priority: "medium",
            },
            executionStage: {
              wakeRole: "executor",
              stageId: "stage-1",
              stageType: "review",
              currentParticipant: { type: "agent", agentId: "qa-agent" },
              returnAssignee: { type: "agent", agentId: "coder-agent" },
              lastDecisionOutcome: "changes_requested",
              allowedActions: ["address_changes", "resubmit"],
            },
            commentIds: [],
            latestCommentId: null,
            comments: [],
            commentWindow: {
              requestedCount: 0,
              includedCount: 0,
              missingCount: 0,
            },
            truncated: false,
            fallbackFetchNeeded: false,
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(executorResult.exitCode).toBe(0);
      const executorCapture = JSON.parse(await fs.readFile(executorCapturePath, "utf8")) as CapturePayload;
      expect(executorCapture.prompt).toContain("execution wake role: executor");
      expect(executorCapture.prompt).toContain("You are waking because changes were requested in the execution workflow.");
      expect(executorCapture.prompt).toContain("allowed actions: address_changes, resubmit");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("renders an issue-scoped wake prompt even when the wake has no comments yet", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-issue-wake-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const result = await execute({
        runId: "run-issue-wake",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {
          issueId: "issue-1",
          taskId: "issue-1",
          wakeReason: "issue_assigned",
          slawWake: {
            reason: "issue_assigned",
            issue: {
              id: "issue-1",
              identifier: "PAP-1201",
              title: "Fix gallery opening for inline images",
              status: "in_progress",
              priority: "medium",
            },
            checkedOutByHarness: true,
            commentIds: [],
            latestCommentId: null,
            comments: [],
            commentWindow: {
              requestedCount: 0,
              includedCount: 0,
              missingCount: 0,
            },
            truncated: false,
            fallbackFetchNeeded: false,
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.slawEnvKeys).toContain("SLAW_WAKE_PAYLOAD_JSON");
      expect(capture.slawWakePayloadJson).not.toBeNull();
      expect(JSON.parse(capture.slawWakePayloadJson ?? "{}")).toMatchObject({
        reason: "issue_assigned",
        issue: {
          identifier: "PAP-1201",
          title: "Fix gallery opening for inline images",
          status: "in_progress",
          priority: "medium",
        },
        checkedOutByHarness: true,
        commentIds: [],
      });
      expect(capture.prompt).toContain("## Slaw Wake Payload");
      expect(capture.prompt).toContain("Do not switch to another issue until you have handled this wake.");
      expect(capture.prompt).toContain("- issue: PAP-1201 Fix gallery opening for inline images");
      expect(capture.prompt).toContain("- pending comments: 0/0");
      expect(capture.prompt).toContain("- issue status: in_progress");
      expect(capture.prompt).toContain("- checkout: already claimed by the harness for this run");
      expect(capture.prompt).toContain("The harness already checked out this issue for the current run.");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses a compact wake delta instead of the full heartbeat prompt when resuming a session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-resume-wake-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const instructionsPath = path.join(root, "AGENTS.md");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(instructionsPath, "You are managed instructions.\n", "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    let invocationPrompt = "";
    let invocationNotes: string[] = [];
    let promptMetrics: Record<string, number> = {};
    try {
      const result = await execute({
        runId: "run-resume-wake",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: {
            sessionId: "codex-session-1",
            cwd: workspace,
          },
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          instructionsFilePath: instructionsPath,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {
          issueId: "issue-1",
          taskId: "issue-1",
          wakeReason: "issue_commented",
          wakeCommentId: "comment-2",
          slawWake: {
            reason: "issue_commented",
            issue: {
              id: "issue-1",
              identifier: "PAP-874",
              title: "chat-speed issues",
              status: "in_progress",
              priority: "medium",
            },
            commentIds: ["comment-2"],
            latestCommentId: "comment-2",
            comments: [
              {
                id: "comment-2",
                issueId: "issue-1",
                body: "Second comment",
                bodyTruncated: false,
                createdAt: "2026-03-28T14:35:10.000Z",
                author: { type: "user", id: "user-1" },
              },
            ],
            commentWindow: {
              requestedCount: 1,
              includedCount: 1,
              missingCount: 0,
            },
            truncated: false,
            fallbackFetchNeeded: false,
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          invocationPrompt = meta.prompt ?? "";
          invocationNotes = meta.commandNotes ?? [];
          promptMetrics = meta.promptMetrics ?? {};
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).toEqual(expect.arrayContaining(["resume", "codex-session-1", "-"]));
      expect(capture.prompt).toContain("## Slaw Resume Delta");
      expect(capture.prompt).toContain("Do not switch to another issue until you have handled this wake.");
      expect(capture.prompt).toContain("Second comment");
      expect(capture.prompt).not.toContain("Follow the slaw heartbeat.");
      expect(capture.prompt).not.toContain("You are managed instructions.");
      expect(invocationPrompt).toContain("## Slaw Resume Delta");
      expect(invocationNotes).toContain(
        "Skipped stdin instruction reinjection because an existing Codex session is being resumed with a wake delta.",
      );
      expect(promptMetrics.instructionsChars).toBe(0);
      expect(promptMetrics.heartbeatPromptChars).toBe(0);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("uses a worktree-isolated CODEX_HOME while preserving shared auth and config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const slawHome = path.join(root, "slaw-home");
    const isolatedCodexHome = path.join(
      slawHome,
      "instances",
      "worktree-1",
      "squads",
      "squad-1",
      "codex-home",
    );
    const homeSkill = path.join(isolatedCodexHome, "skills", "slaw");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await fs.writeFile(path.join(sharedCodexHome, "config.toml"), 'model = "codex-mini-latest"\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousSlawHome = process.env.SLAW_HOME;
    const previousSlawInstanceId = process.env.SLAW_INSTANCE_ID;
    const previousSlawInWorktree = process.env.SLAW_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.SLAW_HOME = slawHome;
    process.env.SLAW_INSTANCE_ID = "worktree-1";
    process.env.SLAW_IN_WORKTREE = "true";
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(isolatedCodexHome);
      expect(capture.argv).toEqual(expect.arrayContaining(["exec", "--json", "-"]));
      expect(capture.prompt).toContain("Follow the slaw heartbeat.");
      expect(capture.slawEnvKeys).toEqual(
        expect.arrayContaining([
          "SLAW_AGENT_ID",
          "SLAW_API_KEY",
          "SLAW_API_URL",
          "SLAW_SQUAD_ID",
          "SLAW_RUN_ID",
        ]),
      );

      const isolatedAuth = path.join(isolatedCodexHome, "auth.json");
      const isolatedConfig = path.join(isolatedCodexHome, "config.toml");

      expect((await fs.lstat(isolatedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(isolatedAuth)).toBe(await fs.realpath(path.join(sharedCodexHome, "auth.json")));
      expect((await fs.lstat(isolatedConfig)).isFile()).toBe(true);
      expect(await fs.readFile(isolatedConfig, "utf8")).toBe('model = "codex-mini-latest"\n');
      expect((await fs.lstat(homeSkill)).isSymbolicLink()).toBe(true);
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining("Using worktree-isolated Codex home"),
        }),
      );
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining('Injected Codex skill "slaw"'),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousSlawHome === undefined) delete process.env.SLAW_HOME;
      else process.env.SLAW_HOME = previousSlawHome;
      if (previousSlawInstanceId === undefined) delete process.env.SLAW_INSTANCE_ID;
      else process.env.SLAW_INSTANCE_ID = previousSlawInstanceId;
      if (previousSlawInWorktree === undefined) delete process.env.SLAW_IN_WORKTREE;
      else process.env.SLAW_IN_WORKTREE = previousSlawInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects an explicit CODEX_HOME config override even in worktree mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "slaw-codex-execute-explicit-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const explicitCodexHome = path.join(root, "explicit-codex-home");
    const slawHome = path.join(root, "slaw-home");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousSlawHome = process.env.SLAW_HOME;
    const previousSlawInstanceId = process.env.SLAW_INSTANCE_ID;
    const previousSlawInWorktree = process.env.SLAW_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.SLAW_HOME = slawHome;
    process.env.SLAW_INSTANCE_ID = "worktree-1";
    process.env.SLAW_IN_WORKTREE = "true";
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const result = await execute({
        runId: "run-2",
        agent: {
          id: "agent-1",
          squadId: "squad-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            SLAW_TEST_CAPTURE_PATH: capturePath,
            CODEX_HOME: explicitCodexHome,
          },
          promptTemplate: "Follow the slaw heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(explicitCodexHome);
      expect((await fs.lstat(path.join(explicitCodexHome, "skills", "slaw"))).isSymbolicLink()).toBe(true);
      await expect(fs.lstat(path.join(slawHome, "instances", "worktree-1", "codex-home"))).rejects.toThrow();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousSlawHome === undefined) delete process.env.SLAW_HOME;
      else process.env.SLAW_HOME = previousSlawHome;
      if (previousSlawInstanceId === undefined) delete process.env.SLAW_INSTANCE_ID;
      else process.env.SLAW_INSTANCE_ID = previousSlawInstanceId;
      if (previousSlawInWorktree === undefined) delete process.env.SLAW_IN_WORKTREE;
      else process.env.SLAW_IN_WORKTREE = previousSlawInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
