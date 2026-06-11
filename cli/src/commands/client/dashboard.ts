import { Command } from "commander";
import type { DashboardSummary } from "@slaw-ai/shared";
import {
  addCommonClientOptions,
  apiPath,
  handleCommandError,
  printOutput,
  resolveCommandContext,
  type BaseClientOptions,
} from "./common.js";

interface DashboardGetOptions extends BaseClientOptions {
  squadId?: string;
}

export function registerDashboardCommands(program: Command): void {
  const dashboard = program.command("dashboard").description("Dashboard summary operations");

  addCommonClientOptions(
    dashboard
      .command("get")
      .description("Get dashboard summary for a squad")
      .requiredOption("-C, --squad-id <id>", "Squad ID")
      .action(async (opts: DashboardGetOptions) => {
        try {
          const ctx = resolveCommandContext(opts, { requireSquad: true });
          const row = await ctx.api.get<DashboardSummary>(apiPath`/api/squads/${ctx.squadId}/dashboard`);
          printOutput(row, { json: ctx.json });
        } catch (err) {
          handleCommandError(err);
        }
      }),
    { includeSquad: false },
  );
}
