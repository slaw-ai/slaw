import fs from "node:fs";
import path from "node:path";
import {
  slawConfigSchema,
  botfatherConfigSchema,
  type SlawConfig,
  type BotfatherConfig,
} from "@slaw-ai/shared";
import { resolveSlawConfigPath } from "./paths.js";

export function readConfigFile(): SlawConfig | null {
  const configPath = resolveSlawConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return slawConfigSchema.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read just the botfather section, resiliently. A runtime "Connect to Control
 * Tower" writes the config file with a botfather section, but a file written on
 * a zero-config (`pnpm dev`) setup may be missing the required `database`/
 * `logging`/`server` sections — in which case the full {@link readConfigFile}
 * parse throws and returns null, silently dropping the saved tower connection
 * on every restart. This salvages the botfather section on its own so the
 * connection survives even when the rest of the file is partial/invalid.
 */
export function readBotfatherConfigSection(): BotfatherConfig | undefined {
  const configPath = resolveSlawConfigPath();
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    if (raw.botfather === undefined) return undefined;
    return botfatherConfigSchema.parse(raw.botfather);
  } catch {
    return undefined;
  }
}

/**
 * Persist a botfather config section to the on-disk config file, so a runtime
 * "Connect to Control Tower" survives restart. Merges into the existing file;
 * tolerates a missing file by writing a minimal one. Best-effort.
 *
 * Note: on a zero-config setup this file may not contain the other required
 * sections (database/logging/server), so the strict {@link readConfigFile}
 * would reject it. That is fine — the loader reads the botfather url back via
 * {@link readBotfatherConfigSection}, which validates this section on its own.
 */
export function writeBotfatherConfigSection(section: BotfatherConfig): void {
  const configPath = resolveSlawConfigPath();
  let current: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configPath)) {
      current = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    }
  } catch {
    current = {};
  }
  // strip undefined (e.g. url cleared on disconnect) so the JSON stays clean
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(section)) {
    if (v !== undefined) cleaned[k] = v;
  }
  current.botfather = cleaned;
  const meta = (current.$meta as Record<string, unknown> | undefined) ?? {};
  current.$meta = { ...meta, version: 1, updatedAt: new Date().toISOString(), source: "configure" };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(current, null, 2) + "\n", { mode: 0o600 });
}
