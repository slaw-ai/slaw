import { Command } from "commander";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface SkillOptions extends BaseClientOptions {
  squadId?: string;
  payloadJson?: string;
  path?: string;
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skill").description("Squad skill operations");

  addSquadGet(skill, "list", "List squad skills", "skills");

  addCommonClientOptions(
    skill
      .command("get")
      .description("Get squad skill details")
      .argument("<skillId>", "Skill ID")
      .option("-C, --squad-id <id>", "Squad ID")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          printOutput(await ctx.api.get(apiPath`/api/squads/${ctx.squadId}/skills/${skillId}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addCommonClientOptions(
    skill
      .command("file")
      .description("Read a squad skill file")
      .argument("<skillId>", "Skill ID")
      .option("-C, --squad-id <id>", "Squad ID")
      .option("--path <path>", "Skill-relative file path", "SKILL.md")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const query = new URLSearchParams({ path: opts.path ?? "SKILL.md" });
          printOutput(await ctx.api.get(`${apiPath`/api/squads/${ctx.squadId}/skills/${skillId}/files`}?${query.toString()}`), { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addSquadPost(skill, "create", "Create a local squad skill", "skills", true);
  addSquadPost(skill, "import", "Import squad skills from a source", "skills/import", true);
  addSquadPost(skill, "scan-projects", "Scan project workspaces for squad skills", "skills/scan-projects", true);

  addCommonClientOptions(
    skill
      .command("file:update")
      .description("Update a squad skill file")
      .argument("<skillId>", "Skill ID")
      .option("-C, --squad-id <id>", "Squad ID")
      .requiredOption("--payload-json <json>", "SquadSkillFileUpdate JSON payload")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          printOutput(
            await ctx.api.patch(apiPath`/api/squads/${ctx.squadId}/skills/${skillId}/files`, parseJson(opts.payloadJson ?? "{}")),
            { json: ctx.json },
          );
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );

  addSkillAction(skill, "update-status", "Get squad skill update status", "update-status", "GET");
  addSkillAction(skill, "install-update", "Install available squad skill update", "install-update", "POST");
  addSkillAction(skill, "delete", "Delete a squad skill", "", "DELETE");
}

function addSquadGet(parent: Command, name: string, description: string, path: string): void {
  addCommonClientOptions(
    parent.command(name).description(description).option("-C, --squad-id <id>", "Squad ID").action(async (opts: SkillOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.get(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addSquadPost(parent: Command, name: string, description: string, path: string, requirePayload = false): void {
  const command = parent.command(name).description(description).option("-C, --squad-id <id>", "Squad ID");
  if (requirePayload) {
    command.requiredOption("--payload-json <json>", "JSON payload");
  } else {
    command.option("--payload-json <json>", "JSON payload", "{}");
  }
  addCommonClientOptions(
    command.action(async (opts: SkillOptions) => {
      try {
        const ctx = resolveCommandContext(opts, { requireSquad: true });
        printOutput(await ctx.api.post(`${apiPath`/api/squads/${ctx.squadId}`}/${path}`, parseJson(opts.payloadJson ?? "{}")), { json: ctx.json });
      } catch (err) {
        handleCommandError(err);
      }
    }),
    { includeSquad: false },
  );
}

function addSkillAction(parent: Command, name: string, description: string, suffix: string, method: "GET" | "POST" | "DELETE"): void {
  addCommonClientOptions(
    parent
      .command(name)
      .description(description)
      .argument("<skillId>", "Skill ID")
      .option("-C, --squad-id <id>", "Squad ID")
      .action(async (skillId: string, opts: SkillOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const path = `${apiPath`/api/squads/${ctx.squadId}/skills/${skillId}`}${suffix ? `/${suffix}` : ""}`;
          const result =
            method === "GET"
              ? await ctx.api.get(path)
              : method === "POST"
                ? await ctx.api.post(path, {})
                : await ctx.api.delete(path);
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
