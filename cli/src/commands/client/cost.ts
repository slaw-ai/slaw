import { Command } from "commander";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface SquadOptions extends BaseClientOptions {
  squadId?: string;
}

interface JsonPayloadOptions extends SquadOptions {
  payloadJson: string;
}

interface IncidentOptions extends SquadOptions {
  payloadJson?: string;
}

export function registerCostCommands(program: Command): void {
  const cost = program.command("cost").description("Cost and finance operations");

  for (const [name, path] of [
    ["summary", "costs/summary"],
    ["by-agent", "costs/by-agent"],
    ["by-agent-model", "costs/by-agent-model"],
    ["by-provider", "costs/by-provider"],
    ["by-biller", "costs/by-biller"],
    ["by-project", "costs/by-project"],
    ["window-spend", "costs/window-spend"],
    ["quota-windows", "costs/quota-windows"],
  ] as const) {
    addSquadGet(cost, name, `Get ${name} cost data`, path);
  }

  addCommonClientOptions(
    cost
      .command("issue")
      .description("Get cost summary for an issue")
      .argument("<issueId>", "Issue ID")
      .action(async (issueId: string, opts: BaseClientOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.get(apiPath`/api/issues/${issueId}/cost-summary`);
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addSquadPostJson(cost, "event:create", "Record a cost event", "cost-events");

  const finance = program.command("finance").description("Finance event and summary operations");
  addSquadPostJson(finance, "event:create", "Record a finance event", "finance-events");
  addSquadGet(finance, "events", "List finance events", "costs/finance-events");
  addSquadGet(finance, "summary", "Get finance summary", "costs/finance-summary");
  addSquadGet(finance, "by-biller", "Get finance summary by biller", "costs/finance-by-biller");
  addSquadGet(finance, "by-kind", "Get finance summary by kind", "costs/finance-by-kind");

  const budget = program.command("budget").description("Budget policy and incident operations");
  addSquadGet(budget, "overview", "Get budget overview", "budgets/overview");
  addSquadPostJson(budget, "policy:upsert", "Create or update a budget policy", "budgets/policies");

  addCommonClientOptions(
    budget
      .command("squad:update")
      .description("Update squad budget")
      .option("-C, --squad-id <id>", "Squad ID")
      .requiredOption("--payload-json <json>", "UpdateBudget JSON payload")
      .action(async (opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const result = await ctx.api.patch(apiPath`/api/squads/${ctx.squadId}/budgets`, parseJson(opts.payloadJson));
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    budget
      .command("agent:update")
      .description("Update agent budget")
      .argument("<agentId>", "Agent ID")
      .requiredOption("--payload-json <json>", "UpdateBudget JSON payload")
      .action(async (agentId: string, opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts);
          const result = await ctx.api.patch(apiPath`/api/agents/${agentId}/budgets`, parseJson(opts.payloadJson));
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
  );

  addCommonClientOptions(
    budget
      .command("incident:resolve")
      .description("Resolve a budget incident")
      .argument("<incidentId>", "Budget incident ID")
      .option("-C, --squad-id <id>", "Squad ID")
      .option("--payload-json <json>", "ResolveBudgetIncident JSON payload", "{}")
      .action(async (incidentId: string, opts: IncidentOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const result = await ctx.api.post(
            apiPath`/api/squads/${ctx.squadId}/budget-incidents/${incidentId}/resolve`,
            parseJson(opts.payloadJson ?? "{}"),
          );
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );
}

function addSquadGet(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent
      .command(name)
      .description(description)
      .option("-C, --squad-id <id>", "Squad ID")
      .action(async (opts: SquadOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const result = await ctx.api.get(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`);
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );
}

function addSquadPostJson(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent
      .command(name)
      .description(description)
      .option("-C, --squad-id <id>", "Squad ID")
      .requiredOption("--payload-json <json>", "JSON payload")
      .action(async (opts: JsonPayloadOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const result = await ctx.api.post(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`, parseJson(opts.payloadJson));
          printOutput(result, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
