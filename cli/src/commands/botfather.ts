import fs from "node:fs";
import { Command } from "commander";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadOrCreateMachineIdentity,
  resolveSlawInstanceId,
  resolveBotfatherCredentialsPath,
} from "@slaw/shared";
import { readConfig, resolveConfigPath } from "../config/store.js";

interface CommonOpts {
  config?: string;
}

function readCredentials(): { apiKey?: string; enrolledAt?: string; url?: string } | null {
  const file = resolveBotfatherCredentialsPath({ instanceId: resolveSlawInstanceId() });
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function botfatherStatus(opts: CommonOpts): void {
  const config = readConfig(opts.config);
  const url = config?.botfather?.url;
  const machine = loadOrCreateMachineIdentity();
  const creds = readCredentials();

  p.log.message(pc.bold("SLAW Control Tower (botfather)"));
  if (!url) {
    p.log.info(`${pc.dim("Status:")} standalone — no control tower configured`);
    p.log.message(pc.dim("Set botfather.url in config to enroll with a tower."));
    return;
  }
  const state = creds?.apiKey ? pc.green("enrolled (active)") : pc.yellow("not enrolled");
  p.log.info(`${pc.dim("Tower:")}      ${url}`);
  p.log.info(`${pc.dim("Enforcement:")} ${config?.botfather?.enforcement ?? "enforce"}`);
  p.log.info(`${pc.dim("Status:")}     ${state}`);
  p.log.info(`${pc.dim("Machine ID:")} ${machine.machineId}`);
  p.log.info(`${pc.dim("Instance:")}   ${resolveSlawInstanceId()}`);
  if (creds?.enrolledAt) p.log.info(`${pc.dim("Enrolled:")}   ${creds.enrolledAt}`);
  p.log.message(pc.dim("The server drives enrollment + reporting while running."));
}

function botfatherReenroll(opts: CommonOpts): void {
  const config = readConfig(opts.config);
  if (!config?.botfather?.url) {
    p.log.error("No control tower configured (botfather.url is unset).");
    return;
  }
  const file = resolveBotfatherCredentialsPath({ instanceId: resolveSlawInstanceId() });
  try {
    if (fs.existsSync(file)) fs.rmSync(file);
  } catch {
    /* best effort */
  }
  p.log.success("Cleared local enrollment credentials.");
  p.log.message(
    pc.dim("The server will re-enroll on next start (or its next enrollment tick if running)."),
  );
}

function botfatherDisconnect(opts: CommonOpts): void {
  const config = readConfig(opts.config);
  if (!config?.botfather?.url) {
    p.log.info("Already standalone — no control tower configured.");
    return;
  }
  if ((config.botfather.enforcement ?? "enforce") === "enforce") {
    p.log.error("Disconnect is blocked: enforcement is 'enforce'.");
    p.log.message(
      pc.dim(`Your organisation manages this. Edit ${resolveConfigPath(opts.config)} only if permitted.`),
    );
    return;
  }
  p.log.message(
    pc.dim("To disconnect, remove botfather.url from your config and restart the server."),
  );
}

export function registerBotfatherCommands(program: Command): void {
  const cmd = program.command("botfather").description("Control tower (botfather) enrollment and reporting");
  cmd
    .command("status")
    .description("Show enrollment + reporting status for this instance")
    .option("-c, --config <path>", "Path to config file")
    .action((opts: CommonOpts) => botfatherStatus(opts));
  cmd
    .command("reenroll")
    .description("Clear local credentials so the instance re-enrolls")
    .option("-c, --config <path>", "Path to config file")
    .action((opts: CommonOpts) => botfatherReenroll(opts));
  cmd
    .command("disconnect")
    .description("Disconnect from the control tower (advisory mode only)")
    .option("-c, --config <path>", "Path to config file")
    .action((opts: CommonOpts) => botfatherDisconnect(opts));
}
