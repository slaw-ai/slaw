import { Command } from "commander";
import { createAgentKeySchema, createOperatorApiKeySchema, type Agent } from "@slaw-ai/shared";
import {
  addCommonClientOptions,
  apiPath,
  formatInlineRecord,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface AgentTokenOptions extends BaseClientOptions {
  squadId?: string;
  agent?: string;
  name?: string;
}

interface OperatorTokenOptions extends BaseClientOptions {
  squadId?: string;
  name?: string;
  expiresAt?: string;
  ttlDays?: string;
  neverExpires?: boolean;
}

interface CreatedAgentKey {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

interface AgentKeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

interface CreatedOperatorKey {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

interface OperatorKeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

export function registerTokenCommands(program: Command): void {
  const token = program.command("token").description("Manage Slaw API tokens");
  const agent = token.command("agent").description("Manage agent API keys");

  addCommonClientOptions(
    agent
      .command("create")
      .description("Create an agent API key")
      .requiredOption("-C, --squad-id <id>", "Squad ID")
      .requiredOption("--agent <agent>", "Agent ID, shortname, or unambiguous name")
      .option("--name <name>", "API key label", "cli-agent")
      .action(async (opts: AgentTokenOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const agentRow = await resolveAgent(ctx.api, ctx.squadId ?? "", opts.agent ?? "");
          const payload = createAgentKeySchema.parse({ name: opts.name });
          const key = await ctx.api.post<CreatedAgentKey>(apiPath`/api/agents/${agentRow.id}/keys`, payload);
          if (!key) throw new Error("Failed to create agent API key");
          printOutput(
            {
              agentId: agentRow.id,
              agentName: agentRow.name,
              squadId: agentRow.squadId,
              key,
            },
            { json: ctx.json },
          );
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    agent
      .command("list")
      .description("List agent API keys")
      .requiredOption("-C, --squad-id <id>", "Squad ID")
      .requiredOption("--agent <agent>", "Agent ID, shortname, or unambiguous name")
      .action(async (opts: AgentTokenOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const agentRow = await resolveAgent(ctx.api, ctx.squadId ?? "", opts.agent ?? "");
          const keys = (await ctx.api.get<AgentKeyRow[]>(apiPath`/api/agents/${agentRow.id}/keys`)) ?? [];
          if (ctx.json) {
            printOutput({ agentId: agentRow.id, squadId: agentRow.squadId, keys }, { json: true });
            return;
          }
          for (const key of keys) {
            console.log(formatInlineRecord({ id: key.id, name: key.name, createdAt: key.createdAt, revokedAt: key.revokedAt ?? null }));
          }
          if (keys.length === 0) printOutput([], { json: false });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    agent
      .command("revoke")
      .description("Revoke an agent API key")
      .argument("<keyId>", "Agent API key ID")
      .requiredOption("-C, --squad-id <id>", "Squad ID")
      .requiredOption("--agent <agent>", "Agent ID, shortname, or unambiguous name")
      .action(async (keyId: string, opts: AgentTokenOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const agentRow = await resolveAgent(ctx.api, ctx.squadId ?? "", opts.agent ?? "");
          const result = await ctx.api.delete<{ ok: true; keyId?: string }>(apiPath`/api/agents/${agentRow.id}/keys/${keyId}`);
          printOutput({ ok: true, agentId: agentRow.id, squadId: agentRow.squadId, ...(result ?? {}) }, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  const operator = token.command("operator").description("Manage operator API keys");

  addCommonClientOptions(
    operator
      .command("create")
      .description("Create a named operator API key")
      .option("-C, --squad-id <id>", "Squad ID used for audit context")
      .option("--name <name>", "API key label", "cli-operator")
      .option("--expires-at <iso8601>", "Expiration timestamp")
      .option("--ttl-days <days>", "Expiration in days from now")
      .option("--never-expires", "Create a non-expiring key")
      .action(async (opts: OperatorTokenOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const expiresAt = resolveOperatorKeyExpiresAt(opts);
          const payload = createOperatorApiKeySchema.parse({
            name: opts.name,
            requestedSquadId: opts.squadId ?? ctx.squadId ?? null,
            expiresAt,
          });
          const key = await ctx.api.post<CreatedOperatorKey>("/api/operator-api-keys", payload);
          if (!key) throw new Error("Failed to create operator API key");
          printOutput({ key }, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    operator
      .command("list")
      .description("List operator API keys for the current operator user")
      .action(async (opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const keys = (await ctx.api.get<OperatorKeyRow[]>("/api/operator-api-keys")) ?? [];
          if (ctx.json) {
            printOutput(keys, { json: true });
            return;
          }
          for (const key of keys) {
            console.log(formatInlineRecord({
              id: key.id,
              name: key.name,
              createdAt: key.createdAt,
              lastUsedAt: key.lastUsedAt,
              expiresAt: key.expiresAt,
              revokedAt: key.revokedAt,
            }));
          }
          if (keys.length === 0) printOutput([], { json: false });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    operator
      .command("revoke")
      .description("Revoke a operator API key")
      .argument("<keyId>", "Operator API key ID")
      .action(async (keyId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.delete<{ ok: true; keyId: string }>(apiPath`/api/operator-api-keys/${keyId}`);
          printOutput(result ?? { ok: true, keyId }, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );
}

async function resolveAgent(api: { get<T>(path: string): Promise<T | null> }, squadId: string, agentRef: string): Promise<Agent> {
  const trimmed = agentRef.trim();
  if (!trimmed) throw new Error("Agent reference is required");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    const agent = await api.get<Agent>(apiPath`/api/agents/${trimmed}`);
    if (!agent || agent.squadId !== squadId) throw new Error(`Agent not found: ${agentRef}`);
    return agent;
  }
  const query = new URLSearchParams({ squadId });
  const agent = await api.get<Agent>(`${apiPath`/api/agents/${trimmed}`}?${query.toString()}`);
  if (!agent || agent.squadId !== squadId) throw new Error(`Agent not found: ${agentRef}`);
  return agent;
}

function resolveOperatorKeyExpiresAt(opts: OperatorTokenOptions): Date | null | undefined {
  if (opts.neverExpires) return null;
  if (opts.expiresAt?.trim()) {
    const date = new Date(opts.expiresAt.trim());
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid --expires-at value: ${opts.expiresAt}`);
    return date;
  }
  if (opts.ttlDays?.trim()) {
    const days = Number(opts.ttlDays);
    if (!Number.isFinite(days) || days <= 0) throw new Error(`Invalid --ttl-days value: ${opts.ttlDays}`);
    return new Date(Date.now() + Math.floor(days * 24 * 60 * 60 * 1000));
  }
  return undefined;
}
