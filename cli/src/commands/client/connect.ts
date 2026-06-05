import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { Agent, Squad } from "@slaw/shared";
import { createAgentKeySchema, createBoardApiKeySchema } from "@slaw/shared";
import { loginBoardCli } from "../../client/board-auth.js";
import { SlawApiClient } from "../../client/http.js";
import { resolveProfile, readContext, setCurrentProfile, upsertProfile } from "../../client/context.js";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  normalizeApiBase,
  printOutput,
  resolveApiBase,
  type BaseClientOptions,
} from "./common.js";

interface ConnectOptions extends BaseClientOptions {
  profile?: string;
  persona?: "board" | "agent";
  apiKeyEnvVarName?: string;
  tokenName?: string;
}

interface CreatedAgentKey {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

interface CreatedBoardKey extends CreatedAgentKey {
  expiresAt: string | null;
}

export function registerConnectCommand(program: Command): void {
  addCommonClientOptions(
    program
      .command("connect")
      .description("Interactively connect the CLI as a board operator or agent")
      .option("--persona <persona>", "Persona to configure: board or agent")
      .option("--api-key-env-var-name <name>", "Env var name to store in the profile", "SLAW_API_KEY")
      .option("--token-name <name>", "Token label to create")
      .action(async (opts: ConnectOptions) => {
        try {
          const result = await connectWizard(opts);
          printOutput(result, { json: opts.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

async function connectWizard(opts: ConnectOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`slaw connect` is interactive. For scripts, pass --api-base/--api-key or use context set/token commands.");
  }

  p.intro(pc.bgCyan(pc.black(" slaw connect ")));

  const context = readContext(opts.context);
  const resolvedProfile = resolveProfile(context, opts.profile);
  const initialApiBase = resolveApiBase(opts, resolvedProfile.profile);
  const apiBaseInput = await p.text({
    message: "Slaw API base",
    initialValue: initialApiBase,
    placeholder: "http://localhost:3100",
  });
  assertNotCancelled(apiBaseInput);
  const apiBase = normalizeApiBase(String(apiBaseInput || initialApiBase));
  console.log(pc.dim(`Checking ${apiBase}/api/health ...`));
  await verifyHealth(apiBase);

  const boardLogin = await loginBoardCli({
    apiBase,
    requestedAccess: "board",
    requestedSquadId: opts.squadId ?? resolvedProfile.profile.squadId ?? null,
    command: "slaw connect",
  });
  const boardApi = new SlawApiClient({ apiBase, apiKey: boardLogin.token });
  const squads = (await boardApi.get<Squad[]>("/api/squads")) ?? [];

  const persona = await choosePersona(opts.persona);
  const profileName = opts.profile?.trim() || await askProfileName(resolvedProfile.name);
  const apiKeyEnvVarName = opts.apiKeyEnvVarName?.trim() || "SLAW_API_KEY";

  if (persona === "board") {
    const squad = await chooseSquad(squads, opts.squadId ?? resolvedProfile.profile.squadId, {
      optional: true,
    });
    const tokenName = opts.tokenName?.trim() || `cli-board-${new Date().toISOString()}`;
    const key = await boardApi.post<CreatedBoardKey>("/api/board-api-keys", createBoardApiKeySchema.parse({
      name: tokenName,
      requestedSquadId: squad?.id ?? null,
    }));
    if (!key) throw new Error("Failed to create board token");
    upsertProfile(profileName, {
      apiBase,
      squadId: squad?.id,
      persona: "board",
      agentId: "",
      agentName: "",
      apiKeyEnvVarName,
      tokenName: key.name,
      tokenId: key.id,
      tokenCreatedAt: key.createdAt,
    }, opts.context);
    setCurrentProfile(profileName, opts.context);
    p.outro(pc.green(`Connected profile '${profileName}' as board.`));
    return {
      ok: true,
      profile: profileName,
      persona: "board",
      apiBase,
      squadId: squad?.id ?? null,
      key: publicKeyResult(key),
      exports: buildExports({ apiBase, squadId: squad?.id, agentId: undefined, envName: apiKeyEnvVarName, token: key.token }),
    };
  }

  const squad = await chooseSquad(squads, opts.squadId ?? resolvedProfile.profile.squadId, {
    optional: false,
  });
  if (!squad) throw new Error("Squad is required for agent profiles");
  const agents = (await boardApi.get<Agent[]>(apiPath`/api/squads/${squad.id}/agents`)) ?? [];
  if (agents.length === 0) throw new Error(`Squad '${squad.name}' has no agents to connect.`);
  const agent = await chooseAgent(agents, resolvedProfile.profile.agentId);
  const tokenName = opts.tokenName?.trim() || `cli-agent-${new Date().toISOString()}`;
  const key = await boardApi.post<CreatedAgentKey>(apiPath`/api/agents/${agent.id}/keys`, createAgentKeySchema.parse({ name: tokenName }));
  if (!key) throw new Error("Failed to create agent token");
  upsertProfile(profileName, {
    apiBase,
    squadId: squad.id,
    persona: "agent",
    agentId: agent.id,
    agentName: agent.name,
    apiKeyEnvVarName,
    tokenName: key.name,
    tokenId: key.id,
    tokenCreatedAt: key.createdAt,
  }, opts.context);
  setCurrentProfile(profileName, opts.context);
  p.outro(pc.green(`Connected profile '${profileName}' as ${agent.name}.`));
  return {
    ok: true,
    profile: profileName,
    persona: "agent",
    apiBase,
    squadId: squad.id,
    agentId: agent.id,
    agentName: agent.name,
    key: publicKeyResult(key),
    exports: buildExports({ apiBase, squadId: squad.id, agentId: agent.id, envName: apiKeyEnvVarName, token: key.token }),
  };
}

async function verifyHealth(apiBase: string): Promise<void> {
  const api = new SlawApiClient({ apiBase });
  await api.get("/api/health");
}

async function choosePersona(input: string | undefined): Promise<"board" | "agent"> {
  if (input === "board" || input === "agent") return input;
  const selected = await p.select({
    message: "Connect as",
    options: [
      { value: "board", label: "Board operator" },
      { value: "agent", label: "Agent in a squad" },
    ],
  });
  assertNotCancelled(selected);
  return selected as "board" | "agent";
}

async function askProfileName(defaultName: string): Promise<string> {
  const profile = await p.text({
    message: "Profile name",
    initialValue: defaultName || "default",
  });
  assertNotCancelled(profile);
  const value = String(profile).trim();
  if (!value) throw new Error("Profile name is required");
  return value;
}

async function chooseSquad(
  squads: Squad[],
  preferredSquadId: string | undefined,
  opts: { optional: boolean },
): Promise<Squad | null> {
  if (squads.length === 0) {
    if (opts.optional) return null;
    throw new Error("No squads are accessible with this board credential.");
  }
  const preferred = preferredSquadId ? squads.find((squad) => squad.id === preferredSquadId) : null;
  if (squads.length === 1 && !opts.optional) return squads[0] ?? null;
  const selected = await p.select({
    message: opts.optional ? "Default squad for this profile" : "Agent squad",
    initialValue: preferred?.id ?? squads[0]?.id,
    options: [
      ...(opts.optional ? [{ value: "", label: "(none)" }] : []),
      ...squads.map((squad) => ({
        value: squad.id,
        label: squad.name,
        hint: squad.id,
      })),
    ],
  });
  assertNotCancelled(selected);
  if (!selected) return null;
  return squads.find((squad) => squad.id === selected) ?? null;
}

async function chooseAgent(agents: Agent[], preferredAgentId: string | undefined): Promise<Agent> {
  const selected = await p.select({
    message: "Agent",
    initialValue: preferredAgentId && agents.some((agent) => agent.id === preferredAgentId)
      ? preferredAgentId
      : agents[0]?.id,
    options: agents.map((agent) => ({
      value: agent.id,
      label: agent.name,
      hint: agent.role,
    })),
  });
  assertNotCancelled(selected);
  const agent = agents.find((item) => item.id === selected);
  if (!agent) throw new Error("Agent selection failed");
  return agent;
}

function buildExports(input: {
  apiBase: string;
  squadId?: string;
  agentId?: string;
  envName: string;
  token: string;
}): string {
  const escaped = (value: string) => value.replace(/'/g, "'\"'\"'");
  return [
    `export SLAW_API_URL='${escaped(input.apiBase)}'`,
    input.squadId ? `export SLAW_SQUAD_ID='${escaped(input.squadId)}'` : null,
    input.agentId ? `export SLAW_AGENT_ID='${escaped(input.agentId)}'` : null,
    `export ${input.envName}='${escaped(input.token)}'`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function publicKeyResult(key: CreatedAgentKey | CreatedBoardKey) {
  return {
    id: key.id,
    name: key.name,
    createdAt: key.createdAt,
    token: key.token,
    expiresAt: "expiresAt" in key ? key.expiresAt : undefined,
  };
}

function assertNotCancelled<T>(value: T | symbol): asserts value is T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}
