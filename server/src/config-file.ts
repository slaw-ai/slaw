import fs from "node:fs";
import path from "node:path";
import { slawConfigSchema, type SlawConfig, type BotfatherConfig } from "@slaw/shared";
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
 * Persist a botfather config section to the on-disk config file, so a runtime
 * "Connect to Control Tower" survives restart. Merges into the existing file;
 * tolerates a missing file by writing a minimal one. Best-effort.
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
