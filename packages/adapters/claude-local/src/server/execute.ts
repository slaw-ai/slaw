import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@slaw-ai/adapter-utils";
import type { RunProcessResult } from "@slaw-ai/adapter-utils/server-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  overrideAdapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  adapterExecutionTargetUsesManagedHome,
  adapterExecutionTargetUsesSlawBridge,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetTimeoutSec,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
  runAdapterExecutionTargetShellCommand,
  startAdapterExecutionTargetSlawBridge,
} from "@slaw-ai/adapter-utils/execution-target";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  parseJson,
  applySlawWorkspaceEnv,
  buildSlawEnv,
  readSlawRuntimeSkillEntries,
  readSlawIssueWorkModeFromContext,
  joinPromptSections,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  refreshSlawWorkspaceEnvForExecution,
  renderTemplate,
  renderSlawWakePrompt,
  rewriteWorkspaceCwdEnvVarsForExecution,
  shapeSlawWorkspaceEnvForExecution,
  stringifySlawWakePayload,
  DEFAULT_SLAW_AGENT_PROMPT_TEMPLATE,
} from "@slaw-ai/adapter-utils/server-utils";
import { shellQuote } from "@slaw-ai/adapter-utils/ssh";
import {
  parseClaudeStreamJson,
  describeClaudeFailure,
  detectClaudeLoginRequired,
  extractClaudeRetryNotBefore,
  isClaudeMaxTurnsResult,
  isClaudeTransientUpstreamError,
  isClaudeUnknownSessionError,
} from "./parse.js";
import { prepareClaudeConfigSeed } from "./claude-config.js";
import { resolveClaudeDesiredSkillNames } from "./skills.js";
import { isBedrockModelId } from "./models.js";
import { prepareClaudePromptBundle } from "./prompt-cache.js";
import { buildClaudeExecutionPermissionArgs } from "./permissions.js";
import { SANDBOX_INSTALL_COMMAND } from "../index.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

interface ClaudeExecutionInput {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  runtimeCommandSpec?: AdapterExecutionContext["runtimeCommandSpec"];
  executionTarget?: ReturnType<typeof readAdapterExecutionTarget>;
  authToken?: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}

interface ClaudeRuntimeConfig {
  command: string;
  resolvedCommand: string;
  cwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  env: Record<string, string>;
  loggedEnv: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
  extraArgs: string[];
}

export function claudeSessionCwdMatchesExecutionTarget(input: {
  runtimeSessionCwd: string;
  effectiveExecutionCwd: string;
  executionTargetIsRemote: boolean;
}): boolean {
  if (input.executionTargetIsRemote || input.runtimeSessionCwd.length === 0) return true;
  return path.resolve(input.runtimeSessionCwd) === path.resolve(input.effectiveExecutionCwd);
}

function buildLoginResult(input: {
  proc: RunProcessResult;
  loginUrl: string | null;
}) {
  return {
    exitCode: input.proc.exitCode,
    signal: input.proc.signal,
    timedOut: input.proc.timedOut,
    stdout: input.proc.stdout,
    stderr: input.proc.stderr,
    loginUrl: input.loginUrl,
  };
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function isBedrockAuth(env: Record<string, string>): boolean {
  return (
    env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    env.CLAUDE_CODE_USE_BEDROCK === "true" ||
    hasNonEmptyEnvValue(env, "ANTHROPIC_BEDROCK_BASE_URL")
  );
}

function resolveClaudeBillingType(env: Record<string, string>): "api" | "subscription" | "metered_api" {
  if (isBedrockAuth(env)) return "metered_api";
  return hasNonEmptyEnvValue(env, "ANTHROPIC_API_KEY") ? "api" : "subscription";
}

async function buildClaudeRuntimeConfig(input: ClaudeExecutionInput): Promise<ClaudeRuntimeConfig> {
  const { runId, agent, config, context, runtimeCommandSpec, executionTarget, authToken } = input;
  const onLog = input.onLog ?? (async () => {});

  const command = asString(config.command, "claude");
  const workspaceContext = parseObject(context.slawWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceId = asString(workspaceContext.workspaceId, "") || null;
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "") || null;
  const workspaceRepoRef = asString(workspaceContext.repoRef, "") || null;
  const workspaceBranch = asString(workspaceContext.branchName, "") || null;
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "") || null;
  const agentHome = asString(workspaceContext.agentHome, "") || null;
  const workspaceHints = Array.isArray(context.slawWorkspaces)
    ? context.slawWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServiceIntents = Array.isArray(context.slawRuntimeServiceIntents)
    ? context.slawRuntimeServiceIntents.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServices = Array.isArray(context.slawRuntimeServices)
    ? context.slawRuntimeServices.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimePrimaryUrl = asString(context.slawRuntimePrimaryUrl, "");
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const shapedWorkspaceEnv = shapeSlawWorkspaceEnvForExecution({
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceWorktreePath,
    workspaceHints,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.SLAW_API_KEY === "string" && envConfig.SLAW_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildSlawEnv(agent) };
  env.SLAW_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifySlawWakePayload(context.slawWake);
  const issueWorkMode = readSlawIssueWorkModeFromContext(context);

  if (wakeTaskId) {
    env.SLAW_TASK_ID = wakeTaskId;
  }
  if (issueWorkMode) {
    env.SLAW_ISSUE_WORK_MODE = issueWorkMode;
  }
  if (wakeReason) {
    env.SLAW_WAKE_REASON = wakeReason;
  }
  if (wakeCommentId) {
    env.SLAW_WAKE_COMMENT_ID = wakeCommentId;
  }
  if (approvalId) {
    env.SLAW_APPROVAL_ID = approvalId;
  }
  if (approvalStatus) {
    env.SLAW_APPROVAL_STATUS = approvalStatus;
  }
  if (linkedIssueIds.length > 0) {
    env.SLAW_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  }
  if (wakePayloadJson) {
    env.SLAW_WAKE_PAYLOAD_JSON = wakePayloadJson;
  }
  applySlawWorkspaceEnv(env, {
    workspaceCwd: shapedWorkspaceEnv.workspaceCwd,
    workspaceSource,
    workspaceStrategy,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceBranch,
    workspaceWorktreePath: shapedWorkspaceEnv.workspaceWorktreePath,
    agentHome,
  });
  if (shapedWorkspaceEnv.workspaceHints.length > 0) {
    env.SLAW_WORKSPACES_JSON = JSON.stringify(shapedWorkspaceEnv.workspaceHints);
  }
  if (runtimeServiceIntents.length > 0) {
    env.SLAW_RUNTIME_SERVICE_INTENTS_JSON = JSON.stringify(runtimeServiceIntents);
  }
  if (runtimeServices.length > 0) {
    env.SLAW_RUNTIME_SERVICES_JSON = JSON.stringify(runtimeServices);
  }
  if (runtimePrimaryUrl) {
    env.SLAW_RUNTIME_PRIMARY_URL = runtimePrimaryUrl;
  }
  const shapedEnvConfig = rewriteWorkspaceCwdEnvVarsForExecution({
    env: envConfig,
    workspaceCwd: effectiveWorkspaceCwd,
    executionCwd: shapedWorkspaceEnv.workspaceCwd,
    executionTargetIsRemote,
  });
  for (const [key, value] of Object.entries(shapedEnvConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  if (!hasExplicitApiKey && authToken) {
    env.SLAW_API_KEY = authToken;
  }

  const runtimeEnv = Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...env })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
    executionTarget,
    asNumber(config.timeoutSec, 0),
  );
  const graceSec = asNumber(config.graceSec, 20);
  await ensureAdapterExecutionTargetRuntimeCommandInstalled({
    runId,
    target: executionTarget,
    installCommand: runtimeCommandSpec?.installCommand,
    detectCommand: runtimeCommandSpec?.detectCommand,
    cwd,
    env: runtimeEnv,
    timeoutSec,
    graceSec,
    onLog,
  });
  await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
    installCommand: SANDBOX_INSTALL_COMMAND,
    timeoutSec,
  });
  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
    resolvedCommand,
  });

  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  return {
    command,
    resolvedCommand,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    loggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  };
}

export async function runClaudeLogin(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context?: Record<string, unknown>;
  authToken?: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}) {
  const onLog = input.onLog ?? (async () => {});
  const runtime = await buildClaudeRuntimeConfig({
    runId: input.runId,
    agent: input.agent,
    config: input.config,
    context: input.context ?? {},
    authToken: input.authToken,
  });

  const proc = await runAdapterExecutionTargetProcess(input.runId, null, runtime.command, ["login"], {
    cwd: runtime.cwd,
    env: runtime.env,
    timeoutSec: runtime.timeoutSec,
    graceSec: runtime.graceSec,
    onLog,
  });

  const loginMeta = detectClaudeLoginRequired({
    parsed: null,
    stdout: proc.stdout,
    stderr: proc.stderr,
  });

  return buildLoginResult({
    proc,
    loginUrl: loginMeta.loginUrl,
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);
  const executionTargetIsSandbox = executionTarget?.kind === "remote" && executionTarget.transport === "sandbox";

  const promptTemplate = asString(
    config.promptTemplate,
    DEFAULT_SLAW_AGENT_PROMPT_TEMPLATE,
  );
  const model = asString(config.model, "");
  const effort = asString(config.effort, "");
  const chrome = asBoolean(config.chrome, false);
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);
  const configEnv = parseObject(config.env);
  const workspaceContext = parseObject(context.slawWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceBranch = asString(workspaceContext.branchName, "") || null;
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "") || null;
  const agentHome = asString(workspaceContext.agentHome, "") || null;
  const workspaceHints = Array.isArray(context.slawWorkspaces)
    ? context.slawWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const hasExplicitClaudeConfigDir =
    typeof configEnv.CLAUDE_CONFIG_DIR === "string" && configEnv.CLAUDE_CONFIG_DIR.trim().length > 0;
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsFileDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  const runtimeConfig = await buildClaudeRuntimeConfig({
    runId,
    agent,
    config,
    context,
    runtimeCommandSpec: ctx.runtimeCommandSpec,
    executionTarget,
    authToken,
    onLog,
  });
  const {
    command,
    resolvedCommand,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    loggedEnv: initialLoggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  } = runtimeConfig;
  let loggedEnv = initialLoggedEnv;
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const terminalResultCleanupGraceMs = Math.max(
    0,
    asNumber(config.terminalResultCleanupGraceMs, 5_000),
  );
  const effectiveEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const billingType = resolveClaudeBillingType(effectiveEnv);
  const claudeSkillEntries = await readSlawRuntimeSkillEntries(config, __moduleDir);
  const desiredSkillNames = new Set(resolveClaudeDesiredSkillNames(config, claudeSkillEntries));
  // When instructionsFilePath is configured, build a stable content-addressed
  // file that includes both the file content and the path directive, so we only
  // need --append-system-prompt-file (Claude CLI forbids using both flags together).
  let combinedInstructionsContents: string | null = null;
  if (instructionsFilePath) {
    try {
      const instructionsContent = await fs.readFile(instructionsFilePath, "utf-8");
      const pathDirective =
        `\nThe above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsFileDir}. ` +
        `This base directory is authoritative for sibling instruction files such as ` +
        `./HEARTBEAT.md, ./SOUL.md, and ./TOOLS.md; do not resolve those from the parent agent directory.`;
      combinedInstructionsContents = instructionsContent + pathDirective;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stderr",
        `[slaw] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }
  const promptBundle = await prepareClaudePromptBundle({
    squadId: agent.squadId,
    skills: claudeSkillEntries.filter((entry) => desiredSkillNames.has(entry.key)),
    instructionsContents: combinedInstructionsContents,
    onLog,
  });
  const useManagedRemoteClaudeConfig =
    executionTargetIsRemote &&
    adapterExecutionTargetUsesManagedHome(executionTarget) &&
    !hasExplicitClaudeConfigDir;
  const claudeConfigSeedDir = useManagedRemoteClaudeConfig
    ? await prepareClaudeConfigSeed(process.env, onLog, agent.squadId)
    : null;
  const preparedExecutionTargetRuntime = executionTargetIsRemote
    ? await (async () => {
        await onLog(
          "stdout",
          `[slaw] Syncing workspace and Claude runtime assets to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
        );
        return await prepareAdapterExecutionTargetRuntime({
          runId,
          target: executionTarget,
          adapterKey: "claude",
          timeoutSec,
          workspaceLocalDir: cwd,
          installCommand: SANDBOX_INSTALL_COMMAND,
          detectCommand: command,
          assets: [
            {
              key: "skills",
              localDir: promptBundle.addDir,
              followSymlinks: true,
            },
            ...(claudeConfigSeedDir
              ? [{
                key: "config-seed",
                localDir: claudeConfigSeedDir,
                followSymlinks: true,
              }]
              : []),
          ],
        });
      })()
    : null;
  if (preparedExecutionTargetRuntime?.workspaceRemoteDir) {
    effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir;
  }
  const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
  refreshSlawWorkspaceEnvForExecution({
    env,
    envConfig: configEnv,
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceSource,
    workspaceStrategy,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceBranch,
    workspaceWorktreePath,
    workspaceHints,
    agentHome,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });
  const restoreRemoteWorkspace = preparedExecutionTargetRuntime
    ? () => preparedExecutionTargetRuntime.restoreWorkspace()
    : null;
  const effectivePromptBundleAddDir = executionTargetIsRemote
    ? preparedExecutionTargetRuntime?.assetDirs.skills ??
      path.posix.join(effectiveExecutionCwd, ".slaw-runtime", "claude", "skills")
    : promptBundle.addDir;
  const effectiveInstructionsFilePath = promptBundle.instructionsFilePath
    ? executionTargetIsRemote
      ? path.posix.join(effectivePromptBundleAddDir, path.basename(promptBundle.instructionsFilePath))
      : promptBundle.instructionsFilePath
    : undefined;
  const remoteClaudeRuntimeRoot = executionTargetIsRemote
    ? preparedExecutionTargetRuntime?.runtimeRootDir ??
      path.posix.join(effectiveExecutionCwd, ".slaw-runtime", "claude")
    : null;
  const remoteClaudeConfigSeedDir = claudeConfigSeedDir && remoteClaudeRuntimeRoot
    ? preparedExecutionTargetRuntime?.assetDirs["config-seed"] ??
      path.posix.join(remoteClaudeRuntimeRoot, "config-seed")
    : null;
  const remoteClaudeConfigDir = useManagedRemoteClaudeConfig && remoteClaudeRuntimeRoot
    ? path.posix.join(remoteClaudeRuntimeRoot, "config")
    : null;
  if (remoteClaudeConfigDir && remoteClaudeConfigSeedDir) {
    env.CLAUDE_CONFIG_DIR = remoteClaudeConfigDir;
    loggedEnv.CLAUDE_CONFIG_DIR = remoteClaudeConfigDir;
    await onLog(
      "stdout",
      `[slaw] Materializing Claude auth/config into ${remoteClaudeConfigDir}.\n`,
    );
    await runAdapterExecutionTargetShellCommand(
      runId,
      executionTarget,
      `mkdir -p ${shellQuote(remoteClaudeConfigDir)} && ` +
        `if [ -d ${shellQuote(remoteClaudeConfigSeedDir)} ]; then ` +
        `cp -R ${shellQuote(`${remoteClaudeConfigSeedDir}/.`)} ${shellQuote(remoteClaudeConfigDir)}/; ` +
        `fi`,
      {
        cwd,
        env,
        timeoutSec: Math.max(timeoutSec, 15),
        graceSec,
        onLog,
      },
    );
  }
  let slawBridge: Awaited<ReturnType<typeof startAdapterExecutionTargetSlawBridge>> = null;
  if (executionTargetIsRemote && adapterExecutionTargetUsesSlawBridge(runtimeExecutionTarget)) {
    slawBridge = await startAdapterExecutionTargetSlawBridge({
      runId,
      target: runtimeExecutionTarget,
      runtimeRootDir: preparedExecutionTargetRuntime?.runtimeRootDir,
      adapterKey: "claude",
      timeoutSec,
      hostApiToken: env.SLAW_API_KEY,
      onLog,
    });
    if (slawBridge) {
      Object.assign(env, slawBridge.env);
      const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
      loggedEnv = buildInvocationEnvForLogs(env, {
        runtimeEnv,
        includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
        resolvedCommand,
      });
      if (remoteClaudeConfigDir) {
        loggedEnv.CLAUDE_CONFIG_DIR = remoteClaudeConfigDir;
      }
    }
  }

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
  const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
  const runtimePromptBundleKey = asString(runtimeSessionParams.promptBundleKey, "");
  const hasMatchingPromptBundle =
    runtimePromptBundleKey.length === 0 || runtimePromptBundleKey === promptBundle.bundleKey;
  const canResumeSession =
    runtimeSessionId.length > 0 &&
    hasMatchingPromptBundle &&
    claudeSessionCwdMatchesExecutionTarget({
      runtimeSessionCwd,
      effectiveExecutionCwd,
      executionTargetIsRemote,
    }) &&
    adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);
  const sessionId = canResumeSession ? runtimeSessionId : null;
  if (
    executionTargetIsRemote &&
    runtimeSessionId &&
    !canResumeSession
  ) {
    await onLog(
      "stdout",
      `[slaw] Claude session "${runtimeSessionId}" does not match the current remote execution identity and will not be resumed in "${effectiveExecutionCwd}". Starting a fresh remote session.\n`,
    );
  } else if (
    runtimeSessionId &&
    runtimeSessionCwd.length > 0 &&
    path.resolve(runtimeSessionCwd) !== path.resolve(effectiveExecutionCwd)
  ) {
    await onLog(
      "stdout",
      `[slaw] Claude session "${runtimeSessionId}" does not match the current remote execution identity and will not be resumed in "${effectiveExecutionCwd}". Starting a fresh remote session.\n`,
    );
  } else if (runtimeSessionId && !canResumeSession) {
    await onLog(
      "stdout",
      `[slaw] Claude session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${effectiveExecutionCwd}".\n`,
    );
  }
  if (runtimeSessionId && runtimePromptBundleKey.length > 0 && runtimePromptBundleKey !== promptBundle.bundleKey) {
    await onLog(
      "stdout",
      `[slaw] Claude session "${runtimeSessionId}" was saved for prompt bundle "${runtimePromptBundleKey}" and will not be resumed with "${promptBundle.bundleKey}".\n`,
    );
  }
  const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
  const templateData = {
    agentId: agent.id,
    squadId: agent.squadId,
    runId,
    squad: { id: agent.squadId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedBootstrapPrompt =
    !sessionId && bootstrapPromptTemplate.trim().length > 0
      ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
      : "";
  const wakePrompt = renderSlawWakePrompt(context.slawWake, { resumedSession: Boolean(sessionId) });
  const shouldUseResumeDeltaPrompt = Boolean(sessionId) && wakePrompt.length > 0;
  const renderedPrompt = shouldUseResumeDeltaPrompt ? "" : renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.slawSessionHandoffMarkdown, "").trim();
  let taskContextNote = asString(context.slawTaskMarkdown, "").trim();

  // F5 — pre-flight prompt-size budget. A prompt that exceeds the model context
  // 400s with "Prompt is too long" and (before the circuit breaker) triggered a
  // retry storm. The task-context note is the largest variable section and the
  // safest to trim, so when the assembled prompt is over budget we truncate it
  // (keeping the head, where the task framing lives) and flag it on stderr.
  // Budget is a generous char proxy for tokens (~4 chars/token); configurable.
  const promptCharBudget = (() => {
    const raw = Number(process.env.SLAW_CLAUDE_PROMPT_CHAR_BUDGET);
    return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
  })();
  let promptBudgetTrimmedChars = 0;
  const assemble = () =>
    joinPromptSections([
      renderedBootstrapPrompt,
      wakePrompt,
      sessionHandoffNote,
      taskContextNote,
      renderedPrompt,
    ]);
  let prompt = assemble();
  if (prompt.length > promptCharBudget && taskContextNote.length > 0) {
    const overBy = prompt.length - promptCharBudget;
    // Trim the task-context note by the overage (plus a small margin), but never
    // below a floor so the agent keeps the task framing.
    const floor = Math.min(taskContextNote.length, 8_000);
    const target = Math.max(floor, taskContextNote.length - overBy - 2_000);
    if (target < taskContextNote.length) {
      promptBudgetTrimmedChars = taskContextNote.length - target;
      taskContextNote =
        taskContextNote.slice(0, target) +
        "\n\n[...task context truncated to fit the prompt budget; see the issue for full detail...]";
      prompt = assemble();
    }
  }
  if (promptBudgetTrimmedChars > 0) {
    await onLog(
      "stdout",
      `[slaw] Prompt exceeded the ${promptCharBudget}-char budget; trimmed ${promptBudgetTrimmedChars} chars of task context to avoid a "prompt too long" failure.\n`,
    );
  }

  const promptMetrics = {
    promptChars: prompt.length,
    bootstrapPromptChars: renderedBootstrapPrompt.length,
    wakePromptChars: wakePrompt.length,
    sessionHandoffChars: sessionHandoffNote.length,
    taskContextChars: taskContextNote.length,
    heartbeatPromptChars: renderedPrompt.length,
    promptBudgetTrimmedChars,
  };

  const buildClaudeArgs = (
    resumeSessionId: string | null,
    attemptInstructionsFilePath: string | undefined,
  ) => {
    const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    args.push(...buildClaudeExecutionPermissionArgs({
      dangerouslySkipPermissions,
      targetIsSandbox: executionTargetIsSandbox,
    }));
    if (chrome) args.push("--chrome");
    // For Bedrock: only pass --model when the ID is a Bedrock-native identifier
    // (e.g. "us.anthropic.*" or ARN). Anthropic-style IDs like "claude-opus-4-6" are invalid
    // on Bedrock, so skip them and let the CLI use its own configured model.
    if (model && (!isBedrockAuth(effectiveEnv) || isBedrockModelId(model))) {
      args.push("--model", model);
    }
    if (effort) args.push("--effort", effort);
    if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
    // On resumed sessions the instructions are already in the session cache;
    // re-injecting them via --append-system-prompt-file wastes 5-10K tokens
    // per heartbeat and the Claude CLI may reject the combination outright.
    if (attemptInstructionsFilePath && !resumeSessionId) {
      args.push("--append-system-prompt-file", attemptInstructionsFilePath);
    }
    args.push("--add-dir", effectivePromptBundleAddDir);
    if (extraArgs.length > 0) args.push(...extraArgs);
    return args;
  };

  const parseFallbackErrorMessage = (proc: RunProcessResult) => {
    const stderrLine =
      proc.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? "";

    if ((proc.exitCode ?? 0) === 0) {
      return "Failed to parse claude JSON output";
    }

    return stderrLine
      ? `Claude exited with code ${proc.exitCode ?? -1}: ${stderrLine}`
      : `Claude exited with code ${proc.exitCode ?? -1}`;
  };

  const runAttempt = async (resumeSessionId: string | null) => {
    const attemptInstructionsFilePath = resumeSessionId ? undefined : effectiveInstructionsFilePath;
    const args = buildClaudeArgs(resumeSessionId, attemptInstructionsFilePath);
    const commandNotes: string[] = [];
    if (!resumeSessionId) {
      commandNotes.push(`Using stable Claude prompt bundle ${promptBundle.bundleKey}.`);
    }
    if (dangerouslySkipPermissions && executionTargetIsSandbox) {
      commandNotes.push(
        "Using a broad --allowedTools whitelist for sandbox execution because Claude rejects --dangerously-skip-permissions under root/sudo.",
      );
    }
    if (attemptInstructionsFilePath && !resumeSessionId) {
      commandNotes.push(
        `Injected agent instructions via --append-system-prompt-file ${instructionsFilePath} (with path directive appended)`,
      );
    }
    if (onMeta) {
      await onMeta({
        adapterType: "claude_local",
        command: resolvedCommand,
        cwd: effectiveExecutionCwd,
        commandArgs: args,
        commandNotes,
        env: loggedEnv,
        prompt,
        promptMetrics,
        context,
      });
    }

    const proc = await runAdapterExecutionTargetProcess(runId, runtimeExecutionTarget, command, args, {
      cwd,
      env,
      stdin: prompt,
      timeoutSec,
      graceSec,
      onSpawn,
      onLog,
      terminalResultCleanup: {
        graceMs: terminalResultCleanupGraceMs,
        hasTerminalResult: ({ stdout }) => parseClaudeStreamJson(stdout).resultJson !== null,
      },
    });

    const parsedStream = parseClaudeStreamJson(proc.stdout);
    const parsed = parsedStream.resultJson ?? parseJson(proc.stdout);
    return { proc, parsedStream, parsed };
  };

  const toAdapterResult = (
    attempt: {
      proc: RunProcessResult;
      parsedStream: ReturnType<typeof parseClaudeStreamJson>;
      parsed: Record<string, unknown> | null;
    },
    opts: { fallbackSessionId: string | null; clearSessionOnMissingSession?: boolean },
  ): AdapterExecutionResult => {
    const { proc, parsedStream, parsed } = attempt;
    const loginMeta = detectClaudeLoginRequired({
      parsed,
      stdout: proc.stdout,
      stderr: proc.stderr,
    });
    const errorMeta =
      loginMeta.loginUrl != null
        ? {
            loginUrl: loginMeta.loginUrl,
          }
        : undefined;

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: "timeout",
        errorMeta,
        clearSession: Boolean(opts.clearSessionOnMissingSession),
      };
    }

    if (!parsed) {
      const fallbackErrorMessage = parseFallbackErrorMessage(proc);
      const transientUpstream =
        !loginMeta.requiresLogin &&
        (proc.exitCode ?? 0) !== 0 &&
        isClaudeTransientUpstreamError({
          parsed: null,
          stdout: proc.stdout,
          stderr: proc.stderr,
          errorMessage: fallbackErrorMessage,
        });
      const transientRetryNotBefore = transientUpstream
        ? extractClaudeRetryNotBefore({
            parsed: null,
            stdout: proc.stdout,
            stderr: proc.stderr,
            errorMessage: fallbackErrorMessage,
          })
        : null;
      const errorCode = loginMeta.requiresLogin
        ? "claude_auth_required"
        : transientUpstream
        ? "claude_transient_upstream"
        : null;
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        errorMessage: fallbackErrorMessage,
        errorCode,
        errorFamily: transientUpstream ? "transient_upstream" : null,
        retryNotBefore: transientRetryNotBefore ? transientRetryNotBefore.toISOString() : null,
        errorMeta,
        resultJson: {
          stdout: proc.stdout,
          stderr: proc.stderr,
          ...(transientUpstream ? { errorFamily: "transient_upstream" } : {}),
          ...(transientRetryNotBefore
            ? { retryNotBefore: transientRetryNotBefore.toISOString() }
            : {}),
          ...(transientRetryNotBefore
            ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() }
            : {}),
        },
        clearSession: Boolean(opts.clearSessionOnMissingSession),
      };
    }

    const usage =
      parsedStream.usage ??
      (() => {
        const usageObj = parseObject(parsed.usage);
        return {
          inputTokens: asNumber(usageObj.input_tokens, 0),
          cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0),
          outputTokens: asNumber(usageObj.output_tokens, 0),
        };
      })();

    const resolvedSessionId =
      parsedStream.sessionId ??
      (asString(parsed.session_id, opts.fallbackSessionId ?? "") || opts.fallbackSessionId);
    const resolvedSessionParams = resolvedSessionId
      ? ({
        sessionId: resolvedSessionId,
        cwd,
        promptBundleKey: promptBundle.bundleKey,
        ...(executionTargetIsRemote
          ? {
              remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
            }
          : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
        ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
      } as Record<string, unknown>)
      : null;
    const clearSessionForMaxTurns = isClaudeMaxTurnsResult(parsed);
    const parsedIsError = asBoolean(parsed.is_error, false);
    const failed = (proc.exitCode ?? 0) !== 0 || parsedIsError;
    const errorMessage = failed
      ? describeClaudeFailure(parsed) ?? `Claude exited with code ${proc.exitCode ?? -1}`
      : null;
    const transientUpstream =
      failed &&
      !loginMeta.requiresLogin &&
      !clearSessionForMaxTurns &&
      isClaudeTransientUpstreamError({
        parsed,
        stdout: proc.stdout,
        stderr: proc.stderr,
        errorMessage,
      });
    const transientRetryNotBefore = transientUpstream
      ? extractClaudeRetryNotBefore({
          parsed,
          stdout: proc.stdout,
          stderr: proc.stderr,
          errorMessage,
        })
      : null;
    const resolvedErrorCode = loginMeta.requiresLogin
      ? "claude_auth_required"
      : failed && clearSessionForMaxTurns
      ? "max_turns_exhausted"
      : transientUpstream
      ? "claude_transient_upstream"
      : null;
    const mergedResultJson: Record<string, unknown> = {
      ...parsed,
      ...(failed && clearSessionForMaxTurns ? { stopReason: "max_turns_exhausted" } : {}),
      ...(transientUpstream ? { errorFamily: "transient_upstream" } : {}),
      ...(transientRetryNotBefore ? { retryNotBefore: transientRetryNotBefore.toISOString() } : {}),
      ...(transientRetryNotBefore ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() } : {}),
    };

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage,
      errorCode: resolvedErrorCode,
      errorFamily: transientUpstream ? "transient_upstream" : null,
      retryNotBefore: transientRetryNotBefore ? transientRetryNotBefore.toISOString() : null,
      errorMeta,
      usage,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: "anthropic",
      biller: isBedrockAuth(effectiveEnv) ? "aws_bedrock" : "anthropic",
      model: parsedStream.model || asString(parsed.model, model),
      billingType,
      costUsd: parsedStream.costUsd ?? asNumber(parsed.total_cost_usd, 0),
      resultJson: mergedResultJson,
      summary: parsedStream.summary || asString(parsed.result, ""),
      clearSession: clearSessionForMaxTurns || Boolean(opts.clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const initial = await runAttempt(sessionId ?? null);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      initial.parsed &&
      isClaudeUnknownSessionError(initial.parsed)
    ) {
      await onLog(
        "stdout",
        `[slaw] Claude resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toAdapterResult(retry, { fallbackSessionId: null, clearSessionOnMissingSession: true });
    }

    return toAdapterResult(initial, { fallbackSessionId: runtimeSessionId || runtime.sessionId });
  } finally {
    if (slawBridge) {
      await slawBridge.stop();
    }
    if (restoreRemoteWorkspace) {
      await onLog(
        "stdout",
        `[slaw] Restoring workspace changes from ${describeAdapterExecutionTarget(executionTarget)}.\n`,
      );
      await restoreRemoteWorkspace();
    }
  }
}
